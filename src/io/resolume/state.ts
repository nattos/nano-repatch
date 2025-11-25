import { makeAutoObservable } from 'mobx';

export class ResolumeParameter {
  id: number;
  name: string;
  type: string;
  value: any;
  path: string;

  constructor(data: any, parentPath: string, name?: string) {
    this.id = data.id;
    this.name = name || data.name || 'Untitled';
    this.type = data.valuetype || 'unknown';
    this.value = data.value;

    // If parentPath ends with /, don't add another one.
    const separator = parentPath.endsWith('/') ? '' : '/';
    // Use the provided name or a sanitized version of the parameter name
    const slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    this.path = `${parentPath}${separator}${slug}`;

    makeAutoObservable(this);
  }

  update(value: any) {
    this.value = value;
  }
}

export class ResolumeEffect {
  id: number;
  name: string;
  params: ResolumeParameter[] = [];
  path: string;

  constructor(data: any, parentPath: string) {
    this.id = data.id;
    this.name = data.name?.value || data.display_name || `Effect ${data.id}`;
    this.path = `${parentPath}/effects/${data.id}`; // Effects are usually addressed by ID in the effects array

    makeAutoObservable(this);
    this.parse(data);
  }

  parse(data: any) {
    // Effects have 'params' object
    if (data.params) {
      for (const [key, value] of Object.entries(data.params)) {
        if (isParameter(value)) {
          this.params.push(new ResolumeParameter(value, this.path, key));
        }
      }
    }
    // Also check for direct parameters like 'bypassed', 'opacity' (if any)
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'params' && isParameter(value)) {
        this.params.push(new ResolumeParameter(value, this.path, key));
      }
    }
  }
}

export class ResolumeClip {
  id: number;
  name: string;
  params: ResolumeParameter[] = [];
  effects: ResolumeEffect[] = [];
  path: string;
  thumbnail?: string;

  constructor(data: any, parentPath: string, index: number) {
    this.id = data.id;
    this.name = data.name?.value || `Clip ${index + 1}`;
    // Clips are addressed by index (1-based) in the layer
    this.path = `${parentPath}/clips/${index + 1}`;

    if (data.thumbnail?.path) {
      this.thumbnail = data.thumbnail.path;
    }

    makeAutoObservable(this);
    this.parse(data);
  }

  parse(data: any) {
    // Parse parameters
    // Clips have 'video', 'audio', 'transport', 'dashboard', etc.
    // We iterate over keys and look for parameters or known sub-structures

    const processObject = (obj: any, currentPath: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'effects' && Array.isArray(value)) {
          value.forEach(eff => this.effects.push(new ResolumeEffect(eff, currentPath)));
        } else if (isParameter(value)) {
          this.params.push(new ResolumeParameter(value, currentPath, key));
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Recurse for nested objects like 'video', 'audio', 'dashboard'
          processObject(value, `${currentPath}/${key}`);
        }
      }
    };

    processObject(data, this.path);
  }
}

export class ResolumeLayer {
  id: number;
  name: string;
  clips: ResolumeClip[] = [];
  params: ResolumeParameter[] = [];
  effects: ResolumeEffect[] = [];
  path: string;

  constructor(data: any, parentPath: string, index: number) {
    this.id = data.id;
    this.name = data.name?.value || `Layer ${index + 1}`;
    // Layers are addressed by index (1-based)
    this.path = `${parentPath}/layers/${index + 1}`;

    makeAutoObservable(this);
    this.parse(data);
  }

  parse(data: any) {
    if (data.clips && Array.isArray(data.clips)) {
      this.clips = data.clips.map((c: any, i: number) => new ResolumeClip(c, this.path, i));
    }

    // Parse layer parameters (opacity, volume, etc.)
    const processObject = (obj: any, currentPath: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'clips') continue; // Handled above

        if (key === 'effects' && Array.isArray(value)) {
          value.forEach(eff => this.effects.push(new ResolumeEffect(eff, currentPath)));
        } else if (isParameter(value)) {
          this.params.push(new ResolumeParameter(value, currentPath, key));
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          processObject(value, `${currentPath}/${key}`);
        }
      }
    };

    processObject(data, this.path);
  }
}

export class ResolumeComposition {
  layers: ResolumeLayer[] = [];
  params: ResolumeParameter[] = [];
  path: string = '/composition';

  constructor() {
    makeAutoObservable(this);
  }

  load(data: any) {
    this.layers = [];
    this.params = [];

    if (data.layers && Array.isArray(data.layers)) {
      this.layers = data.layers.map((l: any, i: number) => new ResolumeLayer(l, this.path, i));
    }

    // Parse composition parameters (master, speed, etc.)
    const processObject = (obj: any, currentPath: string) => {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'layers' || key === 'decks') continue; // Handled or ignored for now

        if (isParameter(value)) {
          this.params.push(new ResolumeParameter(value, currentPath, key));
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          processObject(value, `${currentPath}/${key}`);
        }
      }
    };

    processObject(data, this.path);
  }
}

function isParameter(obj: any): boolean {
  return typeof obj === 'object' && obj !== null && 'valuetype' in obj && 'id' in obj;
}
