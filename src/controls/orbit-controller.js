import { clamp } from "../math.js";

export function createOrbitController(canvas, cameraConfig) {
  let yaw = 0;
  let pitch = cameraConfig.initialPitch;
  let zoom = 1;
  let targetYaw = 0;
  let targetPitch = cameraConfig.initialPitch;
  let targetZoom = 1;
  let orbiting = false;
  let pointerStartX = 0;
  let pointerStartY = 0;

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    orbiting = true;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!orbiting) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    targetYaw -= deltaX * 0.006;
    targetPitch = clamp(
      targetPitch + deltaY * 0.0045,
      cameraConfig.minPitch,
      cameraConfig.maxPitch,
    );
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
  };

  const stopOrbit = (event) => {
    orbiting = false;
    canvas.classList.remove("is-dragging");
    if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    targetZoom = clamp(
      targetZoom + event.deltaY * 0.00075,
      cameraConfig.minZoom,
      cameraConfig.maxZoom,
    );
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stopOrbit);
  canvas.addEventListener("pointercancel", stopOrbit);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  addEventListener("blur", stopOrbit);

  return {
    update() {
      yaw += (targetYaw - yaw) * 0.09;
      pitch += (targetPitch - pitch) * 0.09;
      zoom += (targetZoom - zoom) * 0.09;
      return { yaw, pitch, zoom };
    },

    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopOrbit);
      canvas.removeEventListener("pointercancel", stopOrbit);
      canvas.removeEventListener("wheel", onWheel);
      removeEventListener("blur", stopOrbit);
    },
  };
}
