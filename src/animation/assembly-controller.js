import * as THREE from "../../assets/vendor/three.module.js";
import { clamp, hash, smoothstep } from "../math.js";

export function createAssemblyController({
  set,
  model,
  ui,
  sound,
  reduceMotion,
  search = location.search,
}) {
  const { animation } = set;
  const { batches, modelCenter, totalParts } = model;
  const temporary = new THREE.Object3D();
  const temporaryPosition = new THREE.Vector3();
  const temporaryQuaternion = new THREE.Quaternion();
  const temporaryScale = new THREE.Vector3();
  let startTime = performance.now();
  let pausedAt = 0;
  let paused = false;

  const query = new URLSearchParams(search);
  if (reduceMotion || query.has("complete") || query.has("vortex")) {
    paused = true;
    pausedAt =
      startTime +
      animation.duration *
        (query.has("vortex")
          ? animation.freezeAt.vortex
          : animation.freezeAt.complete);
  }

  function sequenceAt(time) {
    const cycle =
      (((time - startTime) % animation.duration) + animation.duration) %
      animation.duration /
      animation.duration;
    const { formationEnd, assemblyEnd, presentationEnd } = animation.timeline;
    let assembly = 0;
    if (cycle < formationEnd) {
      assembly = 0;
    } else if (cycle < assemblyEnd) {
      assembly = (cycle - formationEnd) / (assemblyEnd - formationEnd);
    } else if (cycle < presentationEnd) {
      assembly = 1;
    } else {
      assembly = 1 - (cycle - presentationEnd) / (1 - presentationEnd);
    }
    return { cycle, assembly: clamp(assembly) };
  }

  function updateInstances(time, assembly) {
    let locked = 0;
    const seconds = time / 1000;
    for (const batch of batches) {
      let dirty = false;
      batch.records.forEach((record, instanceIndex) => {
        const lock = smoothstep(
          (assembly - record.delay) / animation.lockDuration,
        );
        if (lock > 0.995) locked += 1;
        if (Math.abs(lock - record.lastLock) < 0.0001) return;
        record.lastLock = lock;
        dirty = true;

        const orbitSpeed =
          animation.orbitSpeed[0] +
          hash(record.index, 20) *
            (animation.orbitSpeed[1] - animation.orbitSpeed[0]);
        const orbitAngle = record.angle + seconds * orbitSpeed;
        const collapsingRadius =
          record.radius * (1 - lock * animation.collapse);
        temporaryPosition.set(
          modelCenter.x + Math.cos(orbitAngle) * collapsingRadius,
          record.startPosition.y +
            Math.sin(orbitAngle * 2.1) * animation.verticalOrbit,
          modelCenter.z + Math.sin(orbitAngle) * collapsingRadius,
        );
        temporaryPosition.lerp(record.targetPosition, lock);

        temporaryQuaternion.copy(record.startQuaternion);
        temporaryQuaternion.slerp(record.targetQuaternion, lock);
        temporaryScale
          .copy(record.targetScale)
          .multiplyScalar(animation.assemblingScale + lock * (1 - animation.assemblingScale));

        temporary.position.copy(temporaryPosition);
        temporary.quaternion.copy(temporaryQuaternion);
        temporary.scale.copy(temporaryScale);
        temporary.updateMatrix();
        batch.mesh.setMatrixAt(instanceIndex, temporary.matrix);
      });
      if (dirty) batch.mesh.instanceMatrix.needsUpdate = true;
    }
    return locked;
  }

  return {
    update(now) {
      const time = paused ? pausedAt : now;
      const sequence = sequenceAt(time);
      const locked = updateInstances(time, sequence.assembly);
      ui.updateAssembly({
        sequence,
        locked,
        totalParts,
        maxVelocity: animation.maxVelocity,
        completionLabel: set.completionLabel,
        resetAt: animation.timeline.presentationEnd,
      });
      sound.update({ sequence, locked, totalParts, paused });
      return time;
    },

    rebuild() {
      startTime = performance.now() - animation.duration * animation.rebuildOffset;
      paused = false;
      sound.reset();
      batches.forEach((batch) =>
        batch.records.forEach((record) => {
          record.lastLock = -1;
        }),
      );
      ui.setPaused(false);
    },

    togglePause() {
      if (paused) {
        startTime += performance.now() - pausedAt;
        paused = false;
      } else {
        pausedAt = performance.now();
        paused = true;
      }
      ui.setPaused(paused);
    },
  };
}
