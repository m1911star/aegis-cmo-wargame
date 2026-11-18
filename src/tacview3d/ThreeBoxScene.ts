import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SideId } from '../types/wargame';
import {
  DEFAULT_BOX_SCALES,
  type BoxVerticalScale,
  type TacticalBoxSlice,
} from './boxSlice';

export interface TacviewLayerVisibility {
  showRadarEnvelopes: boolean;
  showSeekerCones: boolean;
  showSonobuoyCylinders: boolean;
  showTrails: boolean;
}

export const DEFAULT_TACVIEW_LAYERS: TacviewLayerVisibility = {
  showRadarEnvelopes: true,
  showSeekerCones: true,
  showSonobuoyCylinders: true,
  showTrails: true,
};

export interface ProjectedHudLabel {
  id: string;
  text: string;
  subText?: string;
  side: SideId | 'SYSTEM';
  x: number;
  y: number;
  isAnchor?: boolean;
}

const SIDE_HEX: Record<SideId | 'SYSTEM', number> = {
  RED: 0xf43f5e,
  BLUE: 0x38bdf8,
  NEUTRAL: 0xf59e0b,
  SYSTEM: 0x34d399,
};

function mapY(altM: number, scales: BoxVerticalScale): number {
  const yKm = altM / 1000;
  return altM >= 0 ? yKm * scales.airScale : yKm * scales.subScale;
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m.dispose();
      } else {
        obj.material.dispose();
      }
    }
  });
}

function buildUnitMesh(domain: string, color: number, isAnchor: boolean): THREE.Object3D {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color,
    wireframe: !isAnchor,
    transparent: true,
    opacity: isAnchor ? 0.95 : 0.85,
  });

  if (domain === 'air') {
    const geom = new THREE.ConeGeometry(1.5, 4.4, 4);
    geom.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(geom, mat));
  } else if (domain === 'subsurface') {
    const geom = new THREE.CapsuleGeometry(0.9, 2.8, 4, 8);
    geom.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(geom, mat));
  } else if (domain === 'land') {
    const geom = new THREE.BoxGeometry(2.6, 1.8, 2.6);
    group.add(new THREE.Mesh(geom, mat));
  } else {
    const geom = new THREE.BoxGeometry(1.8, 1.4, 4.4);
    group.add(new THREE.Mesh(geom, mat));
  }

  if (isAnchor) {
    const ringGeom = new THREE.RingGeometry(2.8, 3.3, 24);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    group.add(new THREE.Mesh(ringGeom, ringMat));
  }

  return group;
}

export class ThreeBoxSceneController {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly envGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private rafId: number | null = null;
  private onLabelsUpdate?: (labels: ProjectedHudLabel[]) => void;
  private scales: BoxVerticalScale = DEFAULT_BOX_SCALES;
  private layers: TacviewLayerVisibility = { ...DEFAULT_TACVIEW_LAYERS };
  private labelTargets: Array<{
    id: string;
    text: string;
    subText?: string;
    side: SideId | 'SYSTEM';
    pos: THREE.Vector3;
    isAnchor?: boolean;
  }> = [];

  constructor(container: HTMLElement, onLabelsUpdate?: (labels: ProjectedHudLabel[]) => void) {
    this.container = container;
    this.onLabelsUpdate = onLabelsUpdate;

    const width = Math.max(120, container.clientWidth);
    const height = Math.max(120, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x040813, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x040813, 0.0018);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 1600);
    this.camera.position.set(110, 82, 130);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 520;
    this.controls.minDistance = 18;
    this.controls.target.set(0, 6, 0);

    this.scene.add(this.envGroup);
    this.scene.add(this.dynamicGroup);

    this.startLoop();
  }

  public setScales(scales: BoxVerticalScale): void {
    this.scales = scales;
  }

  public setLayerVisibility(layers: TacviewLayerVisibility): void {
    this.layers = { ...layers };
  }

  public resetCamera(): void {
    this.camera.position.set(110, 82, 130);
    this.controls.target.set(0, 6, 0);
    this.controls.update();
  }

  public resize(): void {
    const width = Math.max(120, this.container.clientWidth);
    const height = Math.max(120, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public updateSlice(slice: TacticalBoxSlice): void {
    this.clearGroup(this.envGroup);
    this.clearGroup(this.dynamicGroup);
    this.labelTargets = [];

    const size = slice.radiusKm * 2;
    const grid = new THREE.GridHelper(size, 12, 0x1e3a5f, 0x0f2137);
    this.envGroup.add(grid);

    // Polar distance rings on sea surface (0m)
    for (const rKm of [25, 50, 100]) {
      if (rKm > slice.radiusKm) continue;
      const ringGeom = new THREE.RingGeometry(rKm - 0.35, rKm + 0.35, 64);
      ringGeom.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x1d4ed8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.32,
      });
      this.envGroup.add(new THREE.Mesh(ringGeom, ringMat));
    }

    // Subsurface thermocline planes (-90m & -140m)
    const thermoUpperY = mapY(slice.thermocline.upperDepthM, this.scales);
    const thermoLowerY = mapY(slice.thermocline.lowerDepthM, this.scales);
    for (const [yVal, opacity] of [[thermoUpperY, 0.08], [thermoLowerY, 0.12]] as const) {
      const planeGeom = new THREE.PlaneGeometry(size, size);
      planeGeom.rotateX(-Math.PI / 2);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(planeGeom, planeMat);
      mesh.position.y = yVal;
      this.envGroup.add(mesh);
    }

    // Weather cloud layer band
    if (slice.clouds && slice.clouds.condition !== 'clear') {
      const cloudFloorY = mapY(slice.clouds.floorM, this.scales);
      const cloudCeilY = mapY(slice.clouds.ceilingM, this.scales);
      const cloudThick = Math.max(0.8, cloudCeilY - cloudFloorY);
      const cloudGeom = new THREE.BoxGeometry(size * 0.92, cloudThick, size * 0.92);
      const cloudMat = new THREE.MeshBasicMaterial({
        color: slice.clouds.condition === 'rain_storm' || slice.clouds.condition === 'typhoon_edge' ? 0x64748b : 0x94a3b8,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      });
      const cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
      cloudMesh.position.y = cloudFloorY + cloudThick / 2;
      this.envGroup.add(cloudMesh);
    }

    // Terrain ridges (extruded polygons)
    for (const ridge of slice.ridges) {
      if (ridge.pointsKm.length < 3) continue;
      const shape = new THREE.Shape();
      // Shape is in XY; after rotateX(-PI/2), shape Y maps to -Z, so negate zKm here
      shape.moveTo(ridge.pointsKm[0].xKm, -ridge.pointsKm[0].zKm);
      for (let i = 1; i < ridge.pointsKm.length; i++) {
        shape.lineTo(ridge.pointsKm[i].xKm, -ridge.pointsKm[i].zKm);
      }
      shape.closePath();

      const extrudeDepth = Math.max(0.8, mapY(ridge.elevationM, this.scales));
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: extrudeDepth,
        bevelEnabled: false,
      });
      geom.rotateX(-Math.PI / 2);

      const mat = new THREE.MeshBasicMaterial({
        color: 0xd97706,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      this.envGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(geom);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.72 })
      );
      this.envGroup.add(line);
    }

    if (slice.mode === 'live') {
      this.renderLiveEntities(slice);
    } else {
      this.renderAarReplay(slice);
    }
  }

  private renderLiveEntities(slice: Extract<TacticalBoxSlice, { mode: 'live' }>): void {
    for (const entity of slice.entities) {
      const y = mapY(entity.altM, this.scales);
      const color = entity.kind === 'contact' ? 0xf59e0b : SIDE_HEX[entity.side];
      const mesh = buildUnitMesh(entity.domain, color, entity.isAnchor);
      mesh.position.set(entity.xKm, y, entity.zKm);
      mesh.rotation.y = THREE.MathUtils.degToRad(-entity.headingDeg);
      this.dynamicGroup.add(mesh);

      // Vertical altitude stalk down/up to sea plane y=0
      const stalkGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(entity.xKm, 0, entity.zKm),
        new THREE.Vector3(entity.xKm, y, entity.zKm),
      ]);
      const stalk = new THREE.Line(
        stalkGeom,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
      );
      this.dynamicGroup.add(stalk);

      if (entity.kind === 'contact' && entity.uncertaintyRadiusKm && entity.uncertaintyRadiusKm > 0.2) {
        const aouGeom = new THREE.RingGeometry(
          Math.max(0.4, entity.uncertaintyRadiusKm - 0.3),
          entity.uncertaintyRadiusKm + 0.3,
          32
        );
        aouGeom.rotateX(-Math.PI / 2);
        const aouMesh = new THREE.Mesh(
          aouGeom,
          new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
        );
        aouMesh.position.set(entity.xKm, 0.05, entity.zKm);
        this.dynamicGroup.add(aouMesh);
      }

      if (this.layers.showRadarEnvelopes && entity.radarEnvelope && entity.radarEnvelope.rangeKm > 1) {
        const { rangeKm, startAngleDeg, sweepAngleDeg } = entity.radarEnvelope;
        const segs = Math.max(12, Math.round((sweepAngleDeg / 360) * 48));
        const perimeter: THREE.Vector3[] = [];
        const positions: number[] = [];
        const envY = Math.max(0.08, y);
        for (let i = 0; i <= segs; i++) {
          const bearingDeg = entity.headingDeg + startAngleDeg + (sweepAngleDeg * i) / segs;
          const rad = (bearingDeg * Math.PI) / 180;
          const px = entity.xKm + rangeKm * Math.sin(rad);
          const pz = entity.zKm - rangeKm * Math.cos(rad);
          perimeter.push(new THREE.Vector3(px, envY, pz));
        }
        for (let i = 0; i < segs; i++) {
          const a = perimeter[i];
          const b = perimeter[i + 1];
          positions.push(entity.xKm, envY, entity.zKm, a.x, a.y, a.z, b.x, b.y, b.z);
        }
        const fanGeom = new THREE.BufferGeometry();
        fanGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const fanMesh = new THREE.Mesh(
          fanGeom,
          new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: entity.isAnchor ? 0.11 : 0.06,
            depthWrite: false,
          })
        );
        this.dynamicGroup.add(fanMesh);

        const outlinePts =
          sweepAngleDeg < 359.5
            ? [
                new THREE.Vector3(entity.xKm, envY, entity.zKm),
                ...perimeter,
                new THREE.Vector3(entity.xKm, envY, entity.zKm),
              ]
            : perimeter;
        this.dynamicGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(outlinePts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: entity.isAnchor ? 0.52 : 0.3 })
          )
        );
      }

      if (this.layers.showSonobuoyCylinders && entity.sonobuoyCylinder) {
        const { radiusKm: buoyRadius, maxDepthM, isActivePing } = entity.sonobuoyCylinder;
        const bottomY = mapY(maxDepthM, this.scales);
        const cylHeight = Math.max(0.6, -bottomY);
        const cylColor = isActivePing ? 0x34d399 : 0x22d3ee;
        const cylGeom = new THREE.CylinderGeometry(buoyRadius, buoyRadius, cylHeight, 28, 1, true);
        const cylMesh = new THREE.Mesh(
          cylGeom,
          new THREE.MeshBasicMaterial({
            color: cylColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: isActivePing ? 0.14 : 0.08,
            depthWrite: false,
          })
        );
        cylMesh.position.set(entity.xKm, bottomY * 0.5, entity.zKm);
        this.dynamicGroup.add(cylMesh);

        for (const ringY of [-0.05, bottomY]) {
          const rGeom = new THREE.RingGeometry(Math.max(0.3, buoyRadius - 0.25), buoyRadius + 0.25, 32);
          rGeom.rotateX(-Math.PI / 2);
          const rMesh = new THREE.Mesh(
            rGeom,
            new THREE.MeshBasicMaterial({
              color: cylColor,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
            })
          );
          rMesh.position.set(entity.xKm, ringY, entity.zKm);
          this.dynamicGroup.add(rMesh);
        }
      }

      if (this.layers.showTrails && entity.trail3d && entity.trail3d.length >= 2) {
        const unitTrailPts = entity.trail3d.map(
          (p) => new THREE.Vector3(p.xKm, mapY(p.altM, this.scales), p.zKm)
        );
        this.dynamicGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(unitTrailPts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65 })
          )
        );
      }

      this.labelTargets.push({
        id: entity.id,
        text: entity.label,
        subText: `${Math.round(entity.altM)}m`,
        side: entity.kind === 'contact' ? 'NEUTRAL' : entity.side,
        pos: new THREE.Vector3(entity.xKm, y + 2.4, entity.zKm),
        isAnchor: entity.isAnchor,
      });
    }

    for (const missile of slice.missiles) {
      const color = missile.isInterceptor ? 0x22d3ee : SIDE_HEX[missile.side];
      const y = mapY(missile.altM, this.scales);

      const headGeom = new THREE.ConeGeometry(0.9, 3.0, 6);
      headGeom.rotateX(Math.PI / 2);
      const head = new THREE.Mesh(headGeom, new THREE.MeshBasicMaterial({ color }));
      head.position.set(missile.xKm, y, missile.zKm);
      head.rotation.y = THREE.MathUtils.degToRad(-missile.headingDeg);
      this.dynamicGroup.add(head);

      if (this.layers.showSeekerCones && missile.seekerCone) {
        const { rangeKm: coneLen, fovDeg, locked } = missile.seekerCone;
        const halfRad = ((fovDeg * 0.5) * Math.PI) / 180;
        const coneRadius = Math.max(1.2, Math.min(coneLen * 0.9, coneLen * Math.tan(halfRad)));
        const coneGeom = new THREE.ConeGeometry(coneRadius, coneLen, 20, 1, true);
        coneGeom.translate(0, -coneLen * 0.5, 0);
        coneGeom.rotateX(Math.PI / 2);
        const coneColor = locked ? 0xfbbf24 : 0x38bdf8;
        const coneMesh = new THREE.Mesh(
          coneGeom,
          new THREE.MeshBasicMaterial({
            color: coneColor,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: locked ? 0.22 : 0.12,
            depthWrite: false,
          })
        );
        coneMesh.position.set(missile.xKm, y, missile.zKm);
        coneMesh.rotation.y = THREE.MathUtils.degToRad(-missile.headingDeg);
        this.dynamicGroup.add(coneMesh);

        const wireMesh = new THREE.LineSegments(
          new THREE.EdgesGeometry(coneGeom),
          new THREE.LineBasicMaterial({
            color: coneColor,
            transparent: true,
            opacity: locked ? 0.7 : 0.42,
          })
        );
        wireMesh.position.set(missile.xKm, y, missile.zKm);
        wireMesh.rotation.y = THREE.MathUtils.degToRad(-missile.headingDeg);
        this.dynamicGroup.add(wireMesh);
      }

      // Vertical stalk
      const stalkGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(missile.xKm, 0, missile.zKm),
        new THREE.Vector3(missile.xKm, y, missile.zKm),
      ]);
      this.dynamicGroup.add(
        new THREE.Line(stalkGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.38 }))
      );

      if (this.layers.showTrails && missile.trail3d.length >= 2) {
        const pts3d = missile.trail3d.map(
          (p) => new THREE.Vector3(p.xKm, mapY(p.altM, this.scales), p.zKm)
        );
        const trailGeom = new THREE.BufferGeometry().setFromPoints(pts3d);
        this.dynamicGroup.add(
          new THREE.Line(trailGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }))
        );

        const groundPts = missile.trail3d.map((p) => new THREE.Vector3(p.xKm, 0.04, p.zKm));
        const shadowGeom = new THREE.BufferGeometry().setFromPoints(groundPts);
        this.dynamicGroup.add(
          new THREE.Line(shadowGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 }))
        );
      }

      this.labelTargets.push({
        id: missile.id,
        text: missile.name,
        subText: `${Math.round(missile.altM)}m`,
        side: missile.side,
        pos: new THREE.Vector3(missile.xKm, y + 1.8, missile.zKm),
      });
    }
  }

  private renderAarReplay(slice: Extract<TacticalBoxSlice, { mode: 'aar' }>): void {
    for (const track of slice.unitTracks) {
      if (track.points.length === 0) continue;
      const color = SIDE_HEX[track.side];
      const latest = track.points[track.points.length - 1];
      const latestY = mapY(latest.altM, this.scales);

      if (this.layers.showTrails && track.points.length >= 2) {
        const pts3d = track.points.map(
          (p) => new THREE.Vector3(p.xKm, mapY(p.altM, this.scales), p.zKm)
        );
        const lineGeom = new THREE.BufferGeometry().setFromPoints(pts3d);
        this.dynamicGroup.add(
          new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88 }))
        );

        const groundPts = track.points.map((p) => new THREE.Vector3(p.xKm, 0.04, p.zKm));
        this.dynamicGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(groundPts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2 })
          )
        );
      }

      const marker = buildUnitMesh(track.domain ?? 'air', color, false);
      marker.position.set(latest.xKm, latestY, latest.zKm);
      this.dynamicGroup.add(marker);

      const stalkGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(latest.xKm, 0, latest.zKm),
        new THREE.Vector3(latest.xKm, latestY, latest.zKm),
      ]);
      this.dynamicGroup.add(
        new THREE.Line(stalkGeom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }))
      );

      this.labelTargets.push({
        id: track.unitId,
        text: track.label,
        subText: `${Math.round(latest.altM)}m`,
        side: track.side,
        pos: new THREE.Vector3(latest.xKm, latestY + 2.4, latest.zKm),
      });
    }

    for (const ev of slice.eventMarkers) {
      const y = mapY(ev.altM, this.scales);
      const color = ev.kind === 'intercept' ? 0x22d3ee : ev.kind === 'loss' ? 0xf43f5e : 0xfbbf24;
      const burstGeom = new THREE.OctahedronGeometry(2.1, 0);
      const burst = new THREE.Mesh(
        burstGeom,
        new THREE.MeshBasicMaterial({ color, wireframe: true })
      );
      burst.position.set(ev.xKm, y, ev.zKm);
      this.dynamicGroup.add(burst);

      this.labelTargets.push({
        id: ev.id,
        text: ev.kind.toUpperCase(),
        subText: `${Math.round(ev.altM)}m`,
        side: ev.side,
        pos: new THREE.Vector3(ev.xKm, y + 2.6, ev.zKm),
      });
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }
  }

  private startLoop(): void {
    const tick = () => {
      this.rafId = window.requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this.onLabelsUpdate) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const projected: ProjectedHudLabel[] = [];
        for (const item of this.labelTargets) {
          const v = item.pos.clone().project(this.camera);
          if (v.z < -1 || v.z > 1) continue;
          const x = (v.x * 0.5 + 0.5) * w;
          const y = (-v.y * 0.5 + 0.5) * h;
          if (x < -40 || x > w + 40 || y < -20 || y > h + 20) continue;
          projected.push({
            id: item.id,
            text: item.text,
            subText: item.subText,
            side: item.side,
            x,
            y,
            isAnchor: item.isAnchor,
          });
        }
        this.onLabelsUpdate(projected);
      }
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  public dispose(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.controls.dispose();
    this.clearGroup(this.envGroup);
    this.clearGroup(this.dynamicGroup);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
