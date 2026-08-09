// The classic segments' `notFound()` boundary. It intentionally renders the
// exact same component as the global `/_not-found` entry rather than a second
// copy of the markup: the only difference between the two is the shell, and
// the classic layout already supplies SiteNav + SiteFooter around whatever
// this boundary renders.
export { default } from "../not-found";
