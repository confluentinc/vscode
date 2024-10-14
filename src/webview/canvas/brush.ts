const [North, South, West, East, Inside, Outside] = [
  0b000001, 0b000010, 0b000100, 0b001000, 0b010000, 0b100000,
];

type Point = [number, number];
type InteractivityState = "idle" | "select" | "drag" | "resize";

/**
 * Brush allows gestures within controlled bounded space in unbounded cartesian
 * coordinates.
 */
export function brush(dimensions: "x" | "y" | "xy") {
  const allowsX = dimensions.includes("x");
  const allowsY = dimensions.includes("y");
  let [[x0, y0], [x1, y1]] = [
    [0, 0],
    [0, 0],
  ];
  let startX: number;
  let startY: number;
  let selection: [Point, Point] | null = null;
  let snapshot: [Point, Point] | null = null;
  let handle: number = Outside;
  let state: InteractivityState = "idle";

  /** Set brushing boundaries by specifying top left and right bottom points of available space */
  function extent(extent: [Point, Point]) {
    [[x0, y0], [x1, y1]] = extent;
  }

  function down(x: number, y: number) {
    startX = x;
    startY = y;
    // snapshot saves current selection state as a starting point for following move events
    snapshot = selection;
    // depending on the starting position, we identify the user's intention
    handle = selection != null ? alignment(x, y, selection, allowsX, allowsY) : Outside;
    state = handle === Outside ? "select" : handle === Inside ? "drag" : "resize";
  }

  function move(x: number, y: number) {
    if (state === "select") {
      // creating selection means composing a rect from initial point to the current cursor position
      const newX0 = allowsX ? Math.max(x0, Math.min(x, startX)) : x0;
      const newX1 = allowsX ? Math.min(Math.max(x, startX), x1) : x1;
      const newY0 = allowsY ? Math.max(y0, Math.min(y, startY)) : y0;
      const newY1 = allowsY ? Math.min(Math.max(y, startY), y1) : y1;
      selection = [
        [newX0, newY0],
        [newX1, newY1],
      ];
    } else if (state === "drag") {
      // dragging selection requires colision computation for extent boundaries
      const dx = x - startX;
      const dy = y - startY;
      const candidateX0 = snapshot![0][0] + dx;
      const candidateX1 = snapshot![1][0] + dx;
      const adjustX = candidateX0 < x0 ? x0 - candidateX0 : candidateX1 > x1 ? x1 - candidateX1 : 0;
      const candidateY0 = snapshot![0][1] + dy;
      const candidateY1 = snapshot![1][1] + dy;
      const adjustY = candidateY0 < y0 ? y0 - candidateY0 : candidateY1 > y1 ? y1 - candidateY1 : 0;
      const newX0 = allowsX ? candidateX0 + adjustX : x0;
      const newX1 = allowsX ? candidateX1 + adjustX : x1;
      const newY0 = allowsY ? candidateY0 + adjustY : y0;
      const newY1 = allowsY ? candidateY1 + adjustY : y1;
      selection = [
        [newX0, newY0],
        [newX1, newY1],
      ];
    } else if (state === "resize") {
      // resizing selection has some similarity to creating selection logic, but with some points being fixed
      const resizeX = allowsX && handle & (West + East);
      const resizeY = allowsY && handle & (North + South);
      const startX = resizeX ? snapshot![handle & East ? 0 : 1][0] : NaN;
      const startY = resizeY ? snapshot![handle & South ? 0 : 1][1] : NaN;
      const newX0 = resizeX ? Math.max(x0, Math.min(x, startX)) : snapshot![0][0];
      const newX1 = resizeX ? Math.min(Math.max(x, startX), x1) : snapshot![1][0];
      const newY0 = resizeY ? Math.max(y0, Math.min(y, startY)) : snapshot![0][1];
      const newY1 = resizeY ? Math.min(Math.max(y, startY), y1) : snapshot![1][1];
      selection = [
        [newX0, newY0],
        [newX1, newY1],
      ];
    }
  }

  function up() {
    state = "idle";
  }

  function cursor(xa: number, ya: number) {
    const handle = selection != null ? alignment(xa, ya, selection, allowsX, allowsY) : Outside;
    switch (handle) {
      case North + West:
      case South + East:
        return "nwse-resize";
      case North + East:
      case South + West:
        return "nesw-resize";
      case North:
      case South:
        return "ns-resize";
      case East:
      case West:
        return "ew-resize";
      case Inside:
        return "move";
      case Outside:
      default:
        return "crosshair";
    }
  }

  function get() {
    return selection;
  }

  function set(points: [Point, Point] | null) {
    selection = points;
  }

  function idle() {
    return state === "idle";
  }

  return { down, move, up, cursor, get, set, idle, extent };
}

/** Additional threshold for calculating collision of pointer and rect edges */
const threshold = 3;

/** Categorize point location on the canvas: Inside, Outside, NSWE edge */
function alignment(
  xa: number,
  ya: number,
  [[x0, y0], [x1, y1]]: [Point, Point],
  allowsX: boolean,
  allowsY: boolean,
) {
  const insideX = x0 < xa && xa < x1;
  const insideY = y0 < ya && ya < y1;
  const alignedW = allowsX && Math.abs(xa - x0) < threshold;
  const alignedE = allowsX && Math.abs(xa - x1) < threshold;
  const alignedN = allowsY && Math.abs(ya - y0) < threshold;
  const alignedS = allowsY && Math.abs(ya - y1) < threshold;
  if (alignedN && alignedW) return North + West;
  if (alignedS && alignedE) return South + East;
  if (alignedN && alignedE) return North + East;
  if (alignedS && alignedW) return South + West;
  if (alignedN && insideX) return North;
  if (alignedS && insideX) return South;
  if (alignedW && insideY) return West;
  if (alignedE && insideY) return East;
  if (insideX && insideY) return Inside;
  return Outside;
}
