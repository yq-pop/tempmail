// 统一帧循环：所有特效共用一个 requestAnimationFrame
const fns = new Set();
let running = false;

function loop(t) {
  for (const f of fns) f(t);
  if (fns.size) requestAnimationFrame(loop); else running = false;
}

export function add(fn) {
  fns.add(fn);
  if (!running) { running = true; requestAnimationFrame(loop); }
  return () => fns.delete(fn);
}
