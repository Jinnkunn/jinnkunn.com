import { SpecialStatePage } from "@/components/special-state-page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <SpecialStatePage
      badge="404"
      layout="inline"
      title="This page could not be found."
      description=""
      actions={
        <Button href="/" className="page-404__btn page-404__btn--primary">
          Back Home
        </Button>
      }
    />
  );
}
