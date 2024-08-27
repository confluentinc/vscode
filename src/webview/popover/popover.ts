/**
 * Listen to popover toggle event and update popover element position to make
 * it floating with regard to the anchor current position. Optionally, you can
 * define `data-position` attribute to define popover's relative position.
 *
 * ```html
 * <button popovertarget="uniqueId">Toggle the popover</button>
 * <div popover id="uniqueId" data-position="bottom-end">Popover content</div>
 * ```
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
 */
export function handlePopoverPosition() {
  document.addEventListener("beforetoggle", handlePopoverToggleEvent, { capture: true });
}

function handlePopoverToggleEvent(event: Event) {
  const popover = event.target as HTMLElement;
  const invoker = document.querySelector(`[popovertarget="${popover.id}"]`);
  if (invoker != null && event instanceof ToggleEvent && event.newState === "open") {
    const { x, y } = computePosition(
      invoker.getBoundingClientRect(),
      popover.getBoundingClientRect(),
      popover.dataset.position ?? "bottom-start",
      document.dir === "rtl",
    );
    popover.style.cssText = `position: absolute; margin: 0; left: ${x}px; top: ${y}px`;
  }
}

/**
 * Compute relative position for a popover that has an anchor.
 * Derived from @floating-ui/core, accomodated for Popover API.
 * @link https://github.com/floating-ui/floating-ui
 */
function computePosition(
  reference: DOMRect,
  floating: DOMRect,
  placement: string,
  rtl: boolean = false,
): { x: number; y: number } {
  let coords: { x: number; y: number };

  const sideAxis = getSideAxis(placement);
  const alignmentAxis = getAlignmentAxis(placement);
  const alignLength = getAxisLength(alignmentAxis);
  const side = getSide(placement);
  const isVertical = sideAxis === "y";

  const commonX = reference.x + reference.width / 2 - floating.width / 2;
  const commonY = reference.y + reference.height / 2 - floating.height / 2;

  switch (side) {
    case "top":
      coords = { x: commonX, y: reference.y - floating.height };
      break;
    case "bottom":
      coords = { x: commonX, y: reference.y + reference.height };
      break;
    case "right":
      coords = { x: reference.x + reference.width, y: commonY };
      break;
    case "left":
      coords = { x: reference.x - floating.width, y: commonY };
      break;
    default:
      coords = { x: reference.x, y: reference.y };
  }

  const commonAlign = reference[alignLength] / 2 - floating[alignLength] / 2;

  switch (getAlignment(placement)) {
    case "start":
      coords[alignmentAxis] -= commonAlign * (rtl && isVertical ? -1 : 1);
      break;
    case "end":
      coords[alignmentAxis] += commonAlign * (rtl && isVertical ? -1 : 1);
      break;
  }

  return coords;
}

function getSideAxis(placement: string) {
  return ["top", "bottom"].includes(placement.split("-")[0]) ? "y" : "x";
}

function getAlignmentAxis(placement: string) {
  return getSideAxis(placement) === "x" ? "y" : "x";
}

function getAxisLength(axis: "x" | "y") {
  return axis === "y" ? "height" : "width";
}

function getSide(placement: string) {
  return placement.split("-")[0] as "top" | "right" | "bottom" | "left";
}

function getAlignment(placement: string) {
  return placement.split("-")[1] as "start" | "end" | undefined;
}
