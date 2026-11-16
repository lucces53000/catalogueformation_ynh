let activeTrigger = null;
let tooltip;

function getTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.className = "calendar-event-popover";
  tooltip.id = "calendar-event-popover";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  return tooltip;
}

function positionTooltip(trigger, popup) {
  const triggerRect = trigger.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(margin, triggerRect.left + (triggerRect.width - popupRect.width) / 2),
    window.innerWidth - popupRect.width - margin
  );
  const belowTop = triggerRect.bottom + 10;
  const showAbove = belowTop + popupRect.height > window.innerHeight - margin;
  popup.classList.toggle("is-above", showAbove);
  popup.style.left = `${left}px`;
  popup.style.top = `${showAbove
    ? Math.max(margin, triggerRect.top - popupRect.height - 10)
    : belowTop}px`;
}

export function attachCalendarPopover(trigger, title, details) {
  trigger.setAttribute("aria-describedby", "calendar-event-popover");
  const show = () => {
    const popup = getTooltip();
    activeTrigger = trigger;
    popup.replaceChildren();

    const heading = document.createElement("strong");
    heading.className = "calendar-event-popover-title";
    heading.textContent = title;
    popup.append(heading);

    details.filter((detail) => detail.value).forEach((detail) => {
      const row = document.createElement("div");
      row.className = "calendar-event-popover-row";
      const label = document.createElement("span");
      label.className = "calendar-event-popover-label";
      label.textContent = detail.label;
      const value = document.createElement("span");
      value.className = "calendar-event-popover-value";
      value.textContent = detail.value;
      row.append(label, value);
      popup.append(row);
    });

    popup.hidden = false;
    positionTooltip(trigger, popup);
  };
  const hide = () => {
    if (trigger.matches(":hover, :focus")) return;
    if (activeTrigger !== trigger) return;
    getTooltip().hidden = true;
    activeTrigger = null;
  };

  trigger.addEventListener("pointerenter", show);
  trigger.addEventListener("pointerleave", hide);
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", hide);
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
}

window.addEventListener("scroll", () => {
  if (activeTrigger) {
    getTooltip().hidden = true;
    activeTrigger = null;
  }
}, true);
