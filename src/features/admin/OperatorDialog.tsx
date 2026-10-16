import { useEffect, useRef, type ReactNode } from "react";

export function OperatorDialog({
  titleId,
  children,
  onClose,
  locked = false,
}: {
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.current?.querySelector<HTMLElement>("input,button,select")?.focus();
    return () => {
      document.body.style.overflow = scroll;
      previous?.focus();
    };
  }, []);
  return (
    <div className="operator-modal-backdrop">
      <section
        ref={element}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="operator-modal"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !locked) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              element.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
              ) ?? [],
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {children}
      </section>
    </div>
  );
}
