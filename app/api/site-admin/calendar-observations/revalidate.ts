import { revalidatePath } from "next/cache";

export function revalidatePublicCalendar() {
  try {
    revalidatePath("/calendar");
    revalidatePath("/api/public/calendar");
    revalidatePath("/api/public/calendar/calendar.ics");
  } catch {
    // Public calendar responses also have bounded cache lifetimes.
  }
}
