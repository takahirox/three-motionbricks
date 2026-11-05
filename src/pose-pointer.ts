import { Group, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, SphereGeometry, TorusGeometry,
  Vector2, Vector3, type Camera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EFFECTORS, type Effector } from './pose-ik';

export type Manipulation = {joint: Effector; position?: Vector3; rotation?: Quaternion};
/** Pointer ownership and projection are independent of IK and inference. */
export class PosePointer {
  readonly object = new Group();
  selected: Effector = 'LeftHand';
  mode: 'move' | 'rotate' = 'move';
  active = false;
  private meshes: Mesh<SphereGeometry,MeshBasicMaterial>[];
  private ring = new Mesh(new TorusGeometry(0.09,0.005,8,40),new MeshBasicMaterial({color:0xffd07a,depthTest:false}));
  private ray = new Raycaster();
  private plane = new Plane();
  private offset = new Vector3();
  private start = new Vector2();
  private pointerId?: number;
  private abort = new AbortController();
  constructor(private canvas: HTMLCanvasElement, private camera: Camera, private orbit: OrbitControls,
    private changed: (change: Manipulation, begin: boolean) => void, private ended: () => void) {
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label','Pose preview. Arrow keys move the selected handle; Shift and arrows rotate.');
    const geometry = new SphereGeometry(0.045,14,10);
    this.meshes = EFFECTORS.map((joint,i) => {
      const mesh = new Mesh(geometry,new MeshBasicMaterial({color:i < 2 ? 0x8ce4ff : 0x9de2ca,depthTest:false}));
      mesh.userData.joint = joint; mesh.renderOrder = 100; this.object.add(mesh); return mesh;
    });
    this.ring.renderOrder = 101; this.object.add(this.ring);
    const options = {signal:this.abort.signal};
    canvas.addEventListener('pointerdown',this.down,{...options,capture:true});
    canvas.addEventListener('pointermove',this.move,options);
    canvas.addEventListener('pointerup',this.up,options);
    canvas.addEventListener('pointercancel',this.up,options);
    canvas.addEventListener('lostpointercapture',this.up,options);
    addEventListener('blur',this.cancel,options);
    window.addEventListener('keydown',event => {if (event.key === 'Escape') this.cancel();},options);
  }
  private project(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),this.camera);
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.active) return;
    this.project(event);
    const hit = this.ray.intersectObjects(this.meshes,false)[0]; if (!hit) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.canvas.focus({preventScroll:true});
    this.selected = hit.object.userData.joint;
    this.active = true; this.pointerId = event.pointerId; this.orbit.enabled = false;
    this.start.set(event.clientX,event.clientY);
    this.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new Vector3()),hit.object.position);
    const point = this.ray.ray.intersectPlane(this.plane,new Vector3())!;
    this.offset.copy(hit.object.position).sub(point);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.changed({joint:this.selected},true);
  };
  private move = (event: PointerEvent) => {
    this.project(event);
    if (!this.active) {
      const hit = this.ray.intersectObjects(this.meshes,false)[0];
      this.canvas.style.cursor = hit ? 'grab' : '';
      for (const mesh of this.meshes) mesh.scale.setScalar(mesh === hit?.object ? 1.35 : 1);
      return;
    }
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    if (this.mode === 'move') {
      const point = this.ray.ray.intersectPlane(this.plane,new Vector3());
      if (point) this.changed({joint:this.selected,position:point.add(this.offset)},false);
    } else {
      const cameraQ = this.camera.getWorldQuaternion(new Quaternion());
      const up = new Vector3(0,1,0).applyQuaternion(cameraQ), right = new Vector3(1,0,0).applyQuaternion(cameraQ);
      const rotation = new Quaternion().setFromAxisAngle(up,(event.clientX-this.start.x)*0.008)
        .multiply(new Quaternion().setFromAxisAngle(right,(event.clientY-this.start.y)*0.008));
      this.changed({joint:this.selected,rotation},false);
    }
  };
  private up = (event: PointerEvent) => {if (event.pointerId === this.pointerId) this.cancel();};
  cancel = () => {
    const id = this.pointerId; this.pointerId = undefined;
    const wasActive = this.active; this.active = false; this.orbit.enabled = true;
    if (id !== undefined && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.canvas.style.cursor = ''; if (wasActive) this.ended();
  };
  update(point: (joint: Effector) => Vector3) {
    for (const mesh of this.meshes) {
      mesh.position.copy(point(mesh.userData.joint));
      mesh.material.color.set(mesh.userData.joint === this.selected ? 0xffd07a : 0x8ce4ff);
    }
    this.ring.visible = this.mode === 'rotate';
    this.ring.position.copy(point(this.selected)); this.ring.quaternion.copy(this.camera.quaternion);
    this.object.updateMatrixWorld(true);
  }
  dispose() {
    this.cancel(); this.abort.abort(); this.object.removeFromParent(); this.meshes[0].geometry.dispose();
    for (const mesh of this.meshes) mesh.material.dispose(); this.ring.geometry.dispose(); this.ring.material.dispose();
  }
}
