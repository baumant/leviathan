import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ActorModelKind = "whale" | "rowboat" | "flagship";

export interface ActorVisualProfile {
  wakeOrigin?: THREE.Vector3;
  harpoonOrigin?: THREE.Vector3;
  tetherAttach?: THREE.Vector3;
  lanternAnchors?: THREE.Vector3[];
  broadsideOrigins?: {
    port: THREE.Vector3[];
    starboard: THREE.Vector3[];
  };
  surfaceSilhouetteScale?: THREE.Vector2;
}

interface CachedActorTemplate {
  readonly scene: THREE.Group;
  readonly profile: ActorVisualProfile;
}

const MODEL_URLS: Record<ActorModelKind, string> = {
  // whale: '/models/whale.glb',
  // rowboat: '/models/rowboat.glb',
  // flagship: '/models/flagship.glb',
};

const SILHOUETTE_DEFAULTS: Record<ActorModelKind, THREE.Vector2> = {
  whale: new THREE.Vector2(4.4, 12.2),
  rowboat: new THREE.Vector2(3.6, 8.6),
  flagship: new THREE.Vector2(24, 58),
};

export class ModelLibrary {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<
    ActorModelKind,
    Promise<CachedActorTemplate | null>
  >();
  private readonly failedKinds = new Set<ActorModelKind>();
  private readonly worldPoint = new THREE.Vector3();

  async getActorModel(
    kind: ActorModelKind,
  ): Promise<CachedActorTemplate | null> {
    let pending = this.cache.get(kind);

    if (!pending) {
      pending = this.loadTemplate(kind);
      this.cache.set(kind, pending);
    }

    const template = await pending;
    if (!template) {
      return null;
    }

    return {
      scene: this.cloneSceneWithMaterials(template.scene),
      profile: this.cloneProfile(template.profile),
    };
  }

  private async loadTemplate(
    kind: ActorModelKind,
  ): Promise<CachedActorTemplate | null> {
    try {
      const gltf = await this.loader.loadAsync(MODEL_URLS[kind]);
      const scene = (gltf.scene ||
        gltf.scenes[0] ||
        new THREE.Group()) as THREE.Group;
      scene.updateMatrixWorld(true);

      const profile = this.extractProfile(scene, kind);
      this.prepareMaterials(scene);
      this.stripMarkers(scene);

      return {
        scene,
        profile,
      };
    } catch (error) {
      if (!this.failedKinds.has(kind)) {
        this.failedKinds.add(kind);
        console.warn(`[ModelLibrary] Failed to load ${kind} model`, error);
      }

      return null;
    }
  }

  private extractProfile(
    scene: THREE.Group,
    kind: ActorModelKind,
  ): ActorVisualProfile {
    const profile: ActorVisualProfile = {
      surfaceSilhouetteScale: SILHOUETTE_DEFAULTS[kind].clone(),
    };

    const broadsidePorts: THREE.Vector3[] = [];
    const broadsideStarboard: THREE.Vector3[] = [];
    const lanternAnchors: THREE.Vector3[] = [];

    scene.traverse((object) => {
      if (!object.name.startsWith("marker:")) {
        return;
      }

      const key = object.name.slice("marker:".length);
      object.getWorldPosition(this.worldPoint);
      const localPoint = scene.worldToLocal(this.worldPoint.clone());

      if (key === "wake_origin") {
        profile.wakeOrigin = localPoint;
      } else if (key === "harpoon_origin") {
        profile.harpoonOrigin = localPoint;
      } else if (key === "tether_attach") {
        profile.tetherAttach = localPoint;
      } else if (key.startsWith("lantern_")) {
        lanternAnchors.push(localPoint);
      } else if (key.startsWith("port_")) {
        broadsidePorts.push(localPoint);
      } else if (key.startsWith("starboard_")) {
        broadsideStarboard.push(localPoint);
      }
    });

    lanternAnchors.sort((left, right) => right.z - left.z);
    broadsidePorts.sort((left, right) => right.z - left.z);
    broadsideStarboard.sort((left, right) => right.z - left.z);

    if (lanternAnchors.length > 0) {
      profile.lanternAnchors = lanternAnchors;
    }

    if (broadsidePorts.length > 0 || broadsideStarboard.length > 0) {
      profile.broadsideOrigins = {
        port: broadsidePorts,
        starboard: broadsideStarboard,
      };
    }

    return profile;
  }

  private prepareMaterials(scene: THREE.Group): void {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const material = object.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.flatShading = true;
        material.needsUpdate = true;
      }
    });
  }

  private cloneSceneWithMaterials(scene: THREE.Group): THREE.Group {
    const clone = scene.clone(true) as THREE.Group;

    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => material.clone());
        return;
      }

      object.material = object.material.clone();
    });

    return clone;
  }

  private stripMarkers(scene: THREE.Group): void {
    const markers: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.name.startsWith("marker:")) {
        markers.push(object);
      }
    });

    for (const marker of markers) {
      marker.removeFromParent();
    }
  }

  private cloneProfile(profile: ActorVisualProfile): ActorVisualProfile {
    return {
      wakeOrigin: profile.wakeOrigin?.clone(),
      harpoonOrigin: profile.harpoonOrigin?.clone(),
      tetherAttach: profile.tetherAttach?.clone(),
      lanternAnchors: profile.lanternAnchors?.map((anchor) => anchor.clone()),
      broadsideOrigins: profile.broadsideOrigins
        ? {
            port: profile.broadsideOrigins.port.map((offset) => offset.clone()),
            starboard: profile.broadsideOrigins.starboard.map((offset) =>
              offset.clone(),
            ),
          }
        : undefined,
      surfaceSilhouetteScale: profile.surfaceSilhouetteScale?.clone(),
    };
  }
}
