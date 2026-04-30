//! EventKit FFI wrappers — only compiled on macOS. The functions here
//! own all the `objc2` / `unsafe` interaction; the rest of the calendar
//! module operates on the safe Rust types in `types.rs`.

#![cfg(target_os = "macos")]

use std::ptr::NonNull;
use std::sync::Mutex;

use block2::RcBlock;
use chrono::{DateTime, SecondsFormat, Utc};
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AnyThread;
use objc2_core_graphics::CGColor;
use objc2_event_kit::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore,
    EKEventStoreChangedNotification, EKRecurrenceEnd, EKRecurrenceFrequency,
    EKRecurrenceRule, EKSourceType, EKSpan,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSNotification, NSNotificationCenter, NSString, NSURL};
use tokio::sync::oneshot;

use crate::calendar::types::{
    Calendar, CalendarAuthorizationStatus, CalendarEvent, CalendarSource, CalendarSourceType,
    CreateEventRequest, FetchEventsRequest, RecurrenceFrequency,
};

// Cap recurrence count so a typo in the UI ("count = 99999") can't
// generate a multi-year event explosion in EventKit. 200 covers four
// years of weekly + a year of daily; anything beyond should go through
// Apple Calendar.app's authoring surface where the operator gets a
// proper RRULE editor.
const MAX_RECURRENCE_COUNT: u32 = 200;

fn map_authorization_status(raw: EKAuthorizationStatus) -> CalendarAuthorizationStatus {
    // EKAuthorizationStatus is a struct-wrapped NSInteger, so we pattern
    // match on the public constants rather than discriminants.
    match raw {
        EKAuthorizationStatus::FullAccess => CalendarAuthorizationStatus::FullAccess,
        EKAuthorizationStatus::WriteOnly => CalendarAuthorizationStatus::WriteOnly,
        EKAuthorizationStatus::Denied => CalendarAuthorizationStatus::Denied,
        EKAuthorizationStatus::Restricted => CalendarAuthorizationStatus::Restricted,
        // NotDetermined (0) is the only remaining value; future-proof
        // against new statuses by treating unknown as NotDetermined too.
        _ => CalendarAuthorizationStatus::NotDetermined,
    }
}

/// Read the current authorization without prompting. Safe to call
/// before `request_access` — returns `NotDetermined` on first launch.
pub fn authorization_status() -> CalendarAuthorizationStatus {
    // SAFETY: `authorizationStatusForEntityType:` is a class method with
    // no preconditions beyond passing a valid EKEntityType, which we do.
    let raw = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    map_authorization_status(raw)
}

/// Trigger the system permission prompt. Resolves with the post-prompt
/// status. The completion block fires on a background queue, so we
/// bridge it through a oneshot channel into the async runtime.
pub async fn request_access() -> Result<CalendarAuthorizationStatus, String> {
    // `Retained<EKEventStore>` is `!Send`, so we must finish all objc
    // interaction *before* the first `.await` — otherwise the resulting
    // future is `!Send` and Tauri rejects it. We dispatch the request
    // inside a non-async scope and only carry the channel receiver out.
    let rx = {
        let (tx, rx) = oneshot::channel::<Result<bool, String>>();

        // SAFETY: `EKEventStore::new()` is alloc+init with no arguments —
        // documented as the standard way to obtain a store.
        let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };

        // The completion block type is `dyn Fn`, but we need to consume
        // the oneshot sender exactly once. Mutex<Option<Sender>> gives us
        // that single-shot behavior through `&self`-level interior
        // mutability, and Mutex makes the captured state `Sync` —
        // required because EventKit invokes the block on a background
        // queue.
        let tx_slot: Mutex<Option<oneshot::Sender<Result<bool, String>>>> = Mutex::new(Some(tx));
        let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            if let Some(tx) = tx_slot.lock().ok().and_then(|mut g| g.take()) {
                if !error.is_null() {
                    // SAFETY: error pointer is non-null per the check;
                    // EventKit owns the NSError and we only read its
                    // localizedDescription.
                    let message = unsafe {
                        let err = &*error;
                        err.localizedDescription().to_string()
                    };
                    let _ = tx.send(Err(message));
                } else {
                    let _ = tx.send(Ok(granted.as_bool()));
                }
            }
        });

        // SAFETY: the API expects a `*mut DynBlock<...>`. RcBlock derefs
        // to DynBlock, and EventKit's `_Block_copy` retains its own
        // reference, so dropping `block`/`store` at the end of this
        // scope is safe — EventKit kept what it needs.
        unsafe {
            store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _);
        }

        rx
    };

    let granted = rx
        .await
        .map_err(|_| "Calendar access request was cancelled".to_string())??;

    if !granted {
        // The user explicitly declined — re-read so we surface the
        // precise denial reason (Denied vs. Restricted by MDM, etc.).
        return Ok(authorization_status());
    }
    Ok(authorization_status())
}

fn map_source_type(raw: EKSourceType) -> CalendarSourceType {
    match raw {
        EKSourceType::Local => CalendarSourceType::Local,
        EKSourceType::Exchange => CalendarSourceType::Exchange,
        EKSourceType::CalDAV => CalendarSourceType::CalDav,
        EKSourceType::MobileMe => CalendarSourceType::MobileMe,
        EKSourceType::Subscribed => CalendarSourceType::Subscribed,
        EKSourceType::Birthdays => CalendarSourceType::Birthdays,
        // Unknown / future variant — fall back to Local rather than
        // erroring; the caller still gets the source's title and id.
        _ => CalendarSourceType::Local,
    }
}

/// Convert a CGColor's RGB components into `#RRGGBB`. Falls back to
/// `#000000` when the color has no readable component pointer (e.g.
/// for non-RGB color spaces we don't handle).
fn cg_color_to_hex(color: &CGColor) -> String {
    let n = CGColor::number_of_components(Some(color));
    let ptr = CGColor::components(Some(color));
    if ptr.is_null() || n == 0 {
        return "#000000".to_string();
    }
    // SAFETY: ptr lifetime is the CGColor's, and we read at most `n`
    // CGFloats — the docs guarantee components is an n-element array.
    let comps = unsafe { std::slice::from_raw_parts(ptr, n) };
    let (r, g, b) = match n {
        4 => (comps[0], comps[1], comps[2]),     // RGBA
        3 => (comps[0], comps[1], comps[2]),     // RGB
        2 => (comps[0], comps[0], comps[0]),     // gray + alpha
        _ => return "#000000".to_string(),
    };
    let to_byte = |v: f64| -> u8 {
        let clamped = v.max(0.0).min(1.0);
        (clamped * 255.0).round() as u8
    };
    // CGFloat is f64 on aarch64-apple-darwin; cast for portability.
    format!(
        "#{:02X}{:02X}{:02X}",
        to_byte(r as f64),
        to_byte(g as f64),
        to_byte(b as f64)
    )
}

pub fn list_sources() -> Result<Vec<CalendarSource>, String> {
    // SAFETY: `EKEventStore::new()` is alloc+init with no preconditions.
    let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };
    // SAFETY: `sources` returns a non-null NSArray by contract.
    let sources = unsafe { store.sources() };

    let mut out = Vec::with_capacity(sources.len());
    for src in sources.iter() {
        // SAFETY: each EKSource accessor is a no-arg objc method that
        // returns a retained NSString / EKSourceType.
        let id = unsafe { src.sourceIdentifier() }.to_string();
        let title = unsafe { src.title() }.to_string();
        let source_type = map_source_type(unsafe { src.sourceType() });
        out.push(CalendarSource {
            id,
            title,
            source_type,
        });
    }
    Ok(out)
}

pub fn list_calendars(source_id: Option<&str>) -> Result<Vec<Calendar>, String> {
    let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };
    // `calendarsForEntityType:` filters out reminders-only calendars,
    // matching what the macOS Calendar app shows under each account.
    // SAFETY: passing a valid EKEntityType variant.
    let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };

    let mut out = Vec::with_capacity(calendars.len());
    for cal in calendars.iter() {
        // A calendar's source is technically Optional (delegate calendars
        // and orphans can return None) — fall back to empty string so
        // the webview can still display the entry under "Other".
        let cal_source_id = unsafe { cal.source() }
            .map(|s| unsafe { s.sourceIdentifier() }.to_string())
            .unwrap_or_default();
        if let Some(filter) = source_id {
            if cal_source_id != filter {
                continue;
            }
        }
        let color_hex = unsafe { cal.CGColor() }
            .map(|c| cg_color_to_hex(&c))
            .unwrap_or_else(|| "#000000".to_string());
        let id = unsafe { cal.calendarIdentifier() }.to_string();
        let title = unsafe { cal.title() }.to_string();
        let allows_modifications = unsafe { cal.allowsContentModifications() };
        out.push(Calendar {
            id,
            source_id: cal_source_id,
            title,
            color_hex,
            allows_modifications,
        });
    }
    Ok(out)
}

fn parse_iso(input: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(input)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| format!("Invalid ISO 8601 timestamp '{}': {}", input, e))
}

fn datetime_to_nsdate(dt: DateTime<Utc>) -> Retained<NSDate> {
    let secs = dt.timestamp() as f64
        + (dt.timestamp_subsec_nanos() as f64) / 1_000_000_000.0;
    NSDate::dateWithTimeIntervalSince1970(secs)
}

fn nsdate_to_iso(date: &NSDate) -> String {
    let secs = date.timeIntervalSince1970();
    // `from_timestamp` rejects negatives we'll never see for calendar
    // events; fall back to "now" so we never panic mid-iteration.
    let whole = secs.trunc() as i64;
    let nanos = ((secs.fract().abs()) * 1_000_000_000.0) as u32;
    let dt = DateTime::<Utc>::from_timestamp(whole, nanos.min(999_999_999))
        .unwrap_or_else(Utc::now);
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn fetch_events(request: &FetchEventsRequest) -> Result<Vec<CalendarEvent>, String> {
    let starts = parse_iso(&request.starts_at)?;
    let ends = parse_iso(&request.ends_at)?;
    if ends <= starts {
        return Err("ends_at must be after starts_at".to_string());
    }

    let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };

    // Build an optional calendar filter. Passing `None` to the predicate
    // lets EventKit fan out across every calendar the user has visible
    // — that's the same behavior macOS Calendar uses when "All
    // Calendars" is selected.
    let calendars_array: Option<Retained<NSArray<EKCalendar>>> = if request.calendar_ids.is_empty()
    {
        None
    } else {
        let all_cals = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        let filtered: Vec<Retained<EKCalendar>> = all_cals
            .iter()
            .filter(|c| {
                let id = unsafe { c.calendarIdentifier() }.to_string();
                request.calendar_ids.iter().any(|wanted| wanted == &id)
            })
            .collect();
        if filtered.is_empty() {
            // Caller asked for specific calendars but none matched — return
            // empty rather than silently widening to "all calendars".
            return Ok(Vec::new());
        }
        Some(NSArray::from_retained_slice(&filtered))
    };

    let start_date = datetime_to_nsdate(starts);
    let end_date = datetime_to_nsdate(ends);

    // SAFETY: predicate factory takes valid NSDate refs and an optional
    // NSArray<EKCalendar>; both invariants hold here.
    let predicate = unsafe {
        store.predicateForEventsWithStartDate_endDate_calendars(
            &start_date,
            &end_date,
            calendars_array.as_deref(),
        )
    };

    // SAFETY: `eventsMatchingPredicate:` returns a non-null NSArray of
    // EKEvent. EventKit pre-expands recurring events into individual
    // occurrences for date-range predicates — no manual RRULE walk
    // needed.
    let events = unsafe { store.eventsMatchingPredicate(&predicate) };

    let mut out = Vec::with_capacity(events.len());
    for ev in events.iter() {
        let event_identifier = unsafe { ev.eventIdentifier() }
            .map(|s| s.to_string())
            .unwrap_or_default();
        let external_identifier =
            unsafe { ev.calendarItemExternalIdentifier() }.map(|s| s.to_string());
        let calendar_id = unsafe { ev.calendar() }
            .map(|c| unsafe { c.calendarIdentifier() }.to_string())
            .unwrap_or_default();
        let title = unsafe { ev.title() }.to_string();
        let notes = unsafe { ev.notes() }.map(|s| s.to_string());
        let location = unsafe { ev.location() }.map(|s| s.to_string());
        let url = unsafe { ev.URL() }
            .and_then(|u| u.absoluteString().map(|s| s.to_string()));
        // Bind the Retained<NSDate> first so `&` produces a stable
        // place expression (compiler can't always coerce
        // `&unsafe { ... }` of a temporary down to `&NSDate`).
        let start_ns = unsafe { ev.startDate() };
        let end_ns = unsafe { ev.endDate() };
        let starts_at = nsdate_to_iso(&start_ns);
        let ends_at = nsdate_to_iso(&end_ns);
        let is_all_day = unsafe { ev.isAllDay() };
        let is_recurring = unsafe { ev.hasRecurrenceRules() };

        out.push(CalendarEvent {
            event_identifier,
            external_identifier,
            calendar_id,
            title,
            notes,
            location,
            url,
            starts_at,
            ends_at,
            is_all_day,
            is_recurring,
        });
    }
    Ok(out)
}

/// Create a new event in the supplied calendar and persist it via
/// EKEventStore.save. Returns the saved event re-projected into the
/// same `CalendarEvent` shape `fetch_events` produces, so the
/// frontend can splice it into its in-memory list without an extra
/// round-trip. Errors:
///   - `MISSING_CALENDAR` — calendar_id didn't resolve to an EKCalendar
///   - `READ_ONLY_CALENDAR` — calendar exists but doesn't allow writes
///     (delegate calendars + Birthdays show up here)
///   - `INVALID_RANGE` — ends_at <= starts_at
///   - any other string is the underlying EventKit error
pub fn create_event(request: &CreateEventRequest) -> Result<CalendarEvent, String> {
    let starts = parse_iso(&request.starts_at)?;
    let ends = parse_iso(&request.ends_at)?;
    if ends <= starts {
        return Err("INVALID_RANGE: ends_at must be after starts_at".to_string());
    }
    if request.title.trim().is_empty() {
        return Err("INVALID_TITLE: title is required".to_string());
    }

    let store: Retained<EKEventStore> = unsafe { EKEventStore::new() };

    // Resolve the target calendar by id. We can't use the
    // `calendarWithIdentifier:` lookup directly without bringing in
    // another feature flag; iterating calendarsForEntityType is
    // O(N) but N is tiny (<20 calendars on a typical machine).
    let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
    let target = calendars.iter().find(|c| {
        unsafe { c.calendarIdentifier() }.to_string() == request.calendar_id
    });
    let target_calendar = match target {
        Some(cal) => cal,
        None => return Err("MISSING_CALENDAR: calendar_id did not match any EKCalendar".to_string()),
    };
    if !unsafe { target_calendar.allowsContentModifications() } {
        return Err(
            "READ_ONLY_CALENDAR: this calendar is read-only (delegate / Birthdays / subscribed)"
                .to_string(),
        );
    }

    // SAFETY: eventWithEventStore: is the documented factory; passing a
    // valid &EKEventStore satisfies the precondition.
    let event: Retained<EKEvent> = unsafe { EKEvent::eventWithEventStore(&store) };
    let title_ns = NSString::from_str(&request.title);
    unsafe { event.setTitle(Some(&title_ns)) };
    unsafe { event.setCalendar(Some(&target_calendar)) };
    let start_ns = datetime_to_nsdate(starts);
    let end_ns = datetime_to_nsdate(ends);
    unsafe { event.setStartDate(Some(&start_ns)) };
    unsafe { event.setEndDate(Some(&end_ns)) };
    unsafe { event.setAllDay(request.is_all_day) };
    if let Some(notes) = request.notes.as_deref() {
        let s = NSString::from_str(notes);
        unsafe { event.setNotes(Some(&s)) };
    }
    if let Some(location) = request.location.as_deref() {
        let s = NSString::from_str(location);
        unsafe { event.setLocation(Some(&s)) };
    }
    if let Some(url) = request.url.as_deref() {
        // NSURL::URLWithString returns Optional — invalid URL strings
        // (e.g. "not a url") return nil. We treat that as a no-op
        // rather than refusing to save the event; the operator can
        // edit the URL field after the fact in Apple Calendar.app.
        let url_ns = NSString::from_str(url);
        if let Some(parsed) = NSURL::URLWithString(&url_ns) {
            unsafe { event.setURL(Some(&parsed)) };
        }
    }

    // Attach a recurrence rule when the operator picked a frequency.
    // EventKit treats `addRecurrenceRule:` as additive — passing a
    // single rule is the typical case (RFC 5545 supports multiple
    // RRULEs per VEVENT but it's rare and harder to reason about).
    if let Some(spec) = request.recurrence.as_ref() {
        let count = spec.count.min(MAX_RECURRENCE_COUNT).max(1);
        let (frequency, interval) = match spec.frequency {
            RecurrenceFrequency::Daily => (EKRecurrenceFrequency::Daily, 1),
            RecurrenceFrequency::Weekly => (EKRecurrenceFrequency::Weekly, 1),
            // Biweekly = weekly with interval=2 — EventKit doesn't have
            // a native biweekly frequency, but every iCal client renders
            // this combo correctly.
            RecurrenceFrequency::Biweekly => (EKRecurrenceFrequency::Weekly, 2),
            RecurrenceFrequency::Monthly => (EKRecurrenceFrequency::Monthly, 1),
        };
        let end = unsafe {
            EKRecurrenceEnd::recurrenceEndWithOccurrenceCount(count as usize)
        };
        // SAFETY: alloc + init dance — initRecurrenceWithFrequency takes
        // a frequency variant, an interval >= 1, and an optional end.
        // All three preconditions are satisfied here.
        let rule: Retained<EKRecurrenceRule> = unsafe {
            let allocated = EKRecurrenceRule::alloc();
            EKRecurrenceRule::initRecurrenceWithFrequency_interval_end(
                allocated,
                frequency,
                interval,
                Some(&end),
            )
        };
        unsafe { event.addRecurrenceRule(&rule) };
    }

    // EKSpan determines whether `saveEvent:` writes one occurrence or
    // the whole series. For brand-new events without a parent series
    // the choice is moot; for events with a recurrence rule we want
    // FutureEvents so the rule itself persists (ThisEvent on a
    // recurring event detaches the occurrence and drops the rule).
    let span = if request.recurrence.is_some() {
        EKSpan::FutureEvents
    } else {
        EKSpan::ThisEvent
    };
    // The objc2-event-kit binding maps `out NSError**` to `Result`,
    // so we just propagate any save failure as an error string.
    if let Err(err) = unsafe { store.saveEvent_span_error(&event, span) } {
        let detail = err.localizedDescription().to_string();
        return Err(format!("SAVE_FAILED: {detail}"));
    }

    // Re-project the saved event back into the wire shape so the JS
    // side can splice it into its event list immediately.
    let event_identifier = unsafe { event.eventIdentifier() }
        .map(|s| s.to_string())
        .unwrap_or_default();
    let external_identifier = unsafe { event.calendarItemExternalIdentifier() }.map(|s| s.to_string());
    let calendar_id = unsafe { event.calendar() }
        .map(|c| unsafe { c.calendarIdentifier() }.to_string())
        .unwrap_or_default();
    let title = unsafe { event.title() }.to_string();
    let notes = unsafe { event.notes() }.map(|s| s.to_string());
    let location = unsafe { event.location() }.map(|s| s.to_string());
    let url = unsafe { event.URL() }
        .and_then(|u| u.absoluteString().map(|s| s.to_string()));
    let start_ns = unsafe { event.startDate() };
    let end_ns = unsafe { event.endDate() };
    let starts_at = nsdate_to_iso(&start_ns);
    let ends_at = nsdate_to_iso(&end_ns);
    let is_all_day = unsafe { event.isAllDay() };
    let is_recurring = unsafe { event.hasRecurrenceRules() };

    Ok(CalendarEvent {
        event_identifier,
        external_identifier,
        calendar_id,
        title,
        notes,
        location,
        url,
        starts_at,
        ends_at,
        is_all_day,
        is_recurring,
    })
}

/// Subscribe to `EKEventStoreChangedNotification` and run `callback`
/// each time EventKit posts one. The notification fires for *any*
/// data change across *any* configured source (iCloud, Outlook,
/// CalDAV, …) — which is exactly what we want to invalidate the
/// frontend cache on.
///
/// The observer token + block are intentionally leaked: they need to
/// live for the entire app lifetime, and we register exactly once at
/// startup. Trying to track and re-register them later just adds
/// failure modes for a notification that never gets unsubscribed in
/// practice.
pub fn install_change_observer<F>(callback: F)
where
    F: Fn() + Send + Sync + 'static,
{
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: the constant is exported from EventKit's framework and
    // stays valid for the process lifetime — it's a static NSString
    // owned by the framework itself.
    let name = unsafe { EKEventStoreChangedNotification };

    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        callback();
    });

    // SAFETY:
    // - `name` is a valid NSNotificationName (NSString) static.
    // - `obj = None` matches notifications from any sender, which is
    //   what we want — we don't have an EKEventStore handle to scope to.
    // - `queue = None` runs the block on whichever thread posts the
    //   notification; the callback we pass in is `Send + Sync`.
    // - The block is `Fn` and `Send`, satisfying the documented
    //   "block must be sendable" requirement.
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            None,
            &block,
        )
    };

    // App-lifetime retention: NSNotificationCenter holds a *weak*
    // reference to its observer token, so we'd lose the subscription
    // the moment `observer` drops. `forget` keeps it alive until
    // process exit. Same reasoning for the block — NSNotificationCenter
    // does copy it via _Block_copy, but we'd rather not rely on that
    // copy outliving every drop path.
    std::mem::forget(observer);
    std::mem::forget(block);
}
