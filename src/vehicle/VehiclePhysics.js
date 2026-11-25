import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const WHEEL_RADIUS = 0.34;
const SUSPENSION_REST = 0.36;

export class VehiclePhysics {
  constructor(rapierWorld, jdmCar) {
    this.world = rapierWorld;
    this.carMesh = jdmCar;

    // Create dynamic chassis rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 10, 0)
      .setLinearDamping(0.08)
      .setAngularDamping(0.35)
      .setCanSleep(false);

    this.chassisBody = this.world.createRigidBody(bodyDesc);

    // Raised box collider so minor photogrammetry bumps on roads don't snag the underside
    const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(0.88, 0.32, 2.02)
      .setTranslation(0, 0.46, 0)
      .setDensity(360)
      .setFriction(0.25)
      .setRestitution(0.05);
    this.world.createCollider(chassisColliderDesc, this.chassisBody);

    // Raycast Vehicle Controller
    this.vehicle = this.world.createVehicleController(this.chassisBody);
    this.wheelOffsets = [
      { x: 0.84, y: 0.24, z: 1.34 },  // 0: Front-Left
      { x: -0.84, y: 0.24, z: 1.34 }, // 1: Front-Right
      { x: 0.86, y: 0.24, z: -1.32 }, // 2: Rear-Left
      { x: -0.86, y: 0.24, z: -1.32 },// 3: Rear-Right
    ];

    const directionCs = { x: 0, y: -1, z: 0 };
    const axleCs = { x: -1, y: 0, z: 0 };

    this.wheelOffsets.forEach((pt, idx) => {
      this.vehicle.addWheel(pt, directionCs, axleCs, SUSPENSION_REST, WHEEL_RADIUS);
      this.vehicle.setWheelSuspensionStiffness(idx, 40.0);
      this.vehicle.setWheelSuspensionCompression?.(idx, 4.6);
      this.vehicle.setWheelSuspensionRelaxation?.(idx, 5.2);
      this.vehicle.setWheelMaxSuspensionTravel?.(idx, 0.32);
      this.vehicle.setWheelFrictionSlip(idx, 2.6);
    });

    this.currentSteer = 0;
    this.speedKmH = 0;
    this.forwardSpeedMs = 0;
    this.isDrifting = false;
    this.isFrozenForStreaming = false;
    this.lastSafePosition = new THREE.Vector3(0, 5, 0);
    this.lastSafeHeading = 0;

    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpVel = new THREE.Vector3();
    this._wheelLocal = new THREE.Vector3();
    this._wheelWorld = new THREE.Vector3();
  }

  setStreamingHold(frozen) {
    this.isFrozenForStreaming = frozen;
    this.chassisBody.setBodyType(
      frozen ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic,
      true
    );
    if (frozen) {
      this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  placeAt(x, y, z, headingRad = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.chassisBody.setTranslation({ x, y, z }, true);
    this.chassisBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastSafePosition.set(x, y, z);
    this.lastSafeHeading = headingRad;
    this.syncVisuals();
  }

  update(dt, input) {
    if (this.isFrozenForStreaming) {
      this.syncVisuals();
      return;
    }

    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    const v = this.chassisBody.linvel();

    this._tmpPos.set(t.x, t.y, t.z);
    this._tmpQuat.set(r.x, r.y, r.z, r.w);
    this._tmpVel.set(v.x, v.y, v.z);

    this._tmpForward.set(0, 0, 1).applyQuaternion(this._tmpQuat);
    this._tmpRight.set(1, 0, 0).applyQuaternion(this._tmpQuat);

    this.forwardSpeedMs = this._tmpVel.dot(this._tmpForward);
    const lateralSpeedMs = Math.abs(this._tmpVel.dot(this._tmpRight));
    this.speedKmH = this._tmpVel.length() * 3.6;

    // Track last upright road position for 'R' reset
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(this._tmpQuat).y;
    if (upY > 0.7 && this.speedKmH < 180) {
      this.lastSafePosition.copy(this._tmpPos);
      this.lastSafeHeading = Math.atan2(this._tmpForward.x, this._tmpForward.z);
    }

    // Speed-sensitive steering (responsive at low speed, stable at high speed)
    const speedNorm = THREE.MathUtils.clamp(this.speedKmH / 160, 0, 1);
    const maxSteer = THREE.MathUtils.lerp(0.52, 0.2, speedNorm);
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const targetSteer = steerInput * maxSteer;
    this.currentSteer = THREE.MathUtils.lerp(this.currentSteer, targetSteer, Math.min(1, dt * 9));

    this.vehicle.setWheelSteering(0, this.currentSteer);
    this.vehicle.setWheelSteering(1, this.currentSteer);

    // Arcade-sim RWD-biased engine torque & top speed taper (~195 km/h)
    const throttle = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const maxSpeedKmH = 195;
    let engineForce = 0;
    let brakeForce = 0;

    if (throttle > 0) {
      if (this.forwardSpeedMs < -1.0) {
        brakeForce = 75;
      } else {
        const taper = 1 - THREE.MathUtils.clamp(this.speedKmH / maxSpeedKmH, 0, 1);
        engineForce = 4200 * (0.35 + 0.65 * taper);
      }
    } else if (throttle < 0) {
      if (this.forwardSpeedMs > 1.2) {
        brakeForce = 85;
      } else {
        engineForce = -2400;
      }
    } else {
      // Gentle engine braking when coasting
      brakeForce = 6;
    }

    // Handbrake / JDM Drift mode (Space)
    const handbrake = Boolean(input.handbrake);
    const rearFriction = handbrake ? 0.85 : 2.65;
    const frontFriction = handbrake ? 2.85 : 2.6;
    this.vehicle.setWheelFrictionSlip(0, frontFriction);
    this.vehicle.setWheelFrictionSlip(1, frontFriction);
    this.vehicle.setWheelFrictionSlip(2, rearFriction);
    this.vehicle.setWheelFrictionSlip(3, rearFriction);

    // Apply power to all 4 wheels (AWD-biased RWD feel for climbing Tokyo ramps cleanly)
    this.vehicle.setWheelEngineForce(0, engineForce * 0.35);
    this.vehicle.setWheelEngineForce(1, engineForce * 0.35);
    this.vehicle.setWheelEngineForce(2, handbrake ? 0 : engineForce * 0.65);
    this.vehicle.setWheelEngineForce(3, handbrake ? 0 : engineForce * 0.65);

    this.vehicle.setWheelBrake(0, brakeForce);
    this.vehicle.setWheelBrake(1, brakeForce);
    this.vehicle.setWheelBrake(2, handbrake ? 55 : brakeForce);
    this.vehicle.setWheelBrake(3, handbrake ? 55 : brakeForce);

    // Subtle controlled yaw assist during handbrake drift
    if (handbrake && this.speedKmH > 18 && Math.abs(steerInput) > 0.05) {
      this.chassisBody.applyTorqueImpulse(
        { x: 0, y: steerInput * 165 * dt * 60, z: 0 },
        true
      );
    }

    // Gentle anti-flip stabilization when wheels are near ground
    if (upY < 0.88 && upY > 0.25) {
      const ang = this.chassisBody.angvel();
      this.chassisBody.setAngvel({ x: ang.x * 0.92, y: ang.y, z: ang.z * 0.92 }, true);
    }

    this.isDrifting = (handbrake && this.speedKmH > 15) || (lateralSpeedMs > 4.2 && this.speedKmH > 25);
    this.carMesh.setBraking(brakeForce > 20 || handbrake || throttle < 0);

    this.vehicle.updateVehicle(dt);
  }

  syncVisuals() {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this._tmpPos.set(t.x, t.y, t.z);
    this._tmpQuat.set(r.x, r.y, r.z, r.w);

    this.carMesh.syncChassisTransform(this._tmpPos, this._tmpQuat);

    for (let i = 0; i < 4; i++) {
      const offset = this.wheelOffsets[i];
      const suspLen = this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      const steer = this.vehicle.wheelSteering(i) ?? 0;
      const spin = this.vehicle.wheelRotation(i) ?? 0;

      this._wheelLocal.set(offset.x, offset.y - suspLen, offset.z);
      this._wheelWorld.copy(this._wheelLocal).applyQuaternion(this._tmpQuat).add(this._tmpPos);
      this.carMesh.syncWheelTransform(i, this._wheelWorld, this._tmpQuat, steer, spin);
    }
  }

  getPosition() {
    const t = this.chassisBody.translation();
    return this._tmpPos.set(t.x, t.y, t.z);
  }

  getHeading() {
    const r = this.chassisBody.rotation();
    this._tmpQuat.set(r.x, r.y, r.z, r.w);
    this._tmpForward.set(0, 0, 1).applyQuaternion(this._tmpQuat);
    return Math.atan2(this._tmpForward.x, this._tmpForward.z);
  }
}
