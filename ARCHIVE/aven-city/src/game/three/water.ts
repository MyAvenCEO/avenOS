/**
 * The living sea — Gerstner-wave water with shore foam and depth shading.
 *
 * Wave spectrum, analytic normals, fold-based foam seeding, detail-normal
 * cascades and the layered foam dissolve are adapted from
 * https://github.com/achrefelouafi/WaterThreeJS (MIT, © achrefelouafi) —
 * simplified for this stylized clay world: instead of GPU depth/refraction
 * targets, water "depth" comes from a CPU-baked COAST DISTANCE FIELD
 * (distance to the nearest land hex), which drives the shallow→deep color
 * ramp and the shoreline foam band that laps against the island walls.
 */
import * as THREE from 'three'
import type { HexTile } from '../hexmap'

/* --- GLSL chunks (from WaterThreeJS common.js, trimmed) ------------------ */

const NOISE = /* glsl */ `
  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec3 noised(vec2 x){
    vec2 p = floor(x);
    vec2 f = fract(x);
    vec2 u  = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash21(p + vec2(0.0, 0.0));
    float b = hash21(p + vec2(1.0, 0.0));
    float c = hash21(p + vec2(0.0, 1.0));
    float d = hash21(p + vec2(1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k3 = a - b - c + d;
    float n  = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
    vec2  g  = du * vec2(k1 + k3 * u.y, k2 + k3 * u.x);
    return vec3(n, g);
  }
  const mat2 FBM_M = mat2(1.6, 1.2, -1.2, 1.6);
  float fbm(vec2 p, int oct){
    float amp = 0.5, sum = 0.0;
    for (int i = 0; i < 8; i++){
      if (i >= oct) break;
      sum += amp * noised(p).x;
      p = FBM_M * p;
      amp *= 0.5;
    }
    return sum;
  }
`

const GERSTNER = /* glsl */ `
  #define MAX_WAVES 24
  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uWaveCount;
  uniform float uBaseFreq;
  uniform float uAmplitude;
  uniform float uChoppy;
  uniform float uDirSpread;
  uniform float uFreqMul;
  uniform float uAmpMul;
  uniform float uSpeed;

  struct WaveSample {
    vec3  displacement;
    vec3  normal;
    float fold;
    float height;
  };

  WaveSample sampleOcean(vec2 pos){
    vec3  disp = vec3(0.0);
    vec3  nrm  = vec3(0.0, 1.0, 0.0);
    float jxx = 1.0, jzz = 1.0, jxz = 0.0;
    float baseAngle = atan(uWindDir.y, uWindDir.x);
    float freq  = uBaseFreq;
    float amp   = uAmplitude;
    int   count = int(uWaveCount);
    for (int i = 0; i < MAX_WAVES; i++){
      if (i >= count) break;
      float fi = float(i);
      float r0 = hash21(vec2(fi, 1.7));
      float r1 = hash21(vec2(fi, 9.1));
      float angle = baseAngle + (r0 * 2.0 - 1.0) * uDirSpread;
      vec2  d = vec2(cos(angle), sin(angle));
      float w = freq;
      float A = amp;
      float phase = sqrt(9.81 * w) * uSpeed;
      float Q = uChoppy / max(w * A * uWaveCount, 1e-3);
      float arg = w * dot(d, pos) + uTime * phase + r1 * 6.2831853;
      float s = sin(arg);
      float c = cos(arg);
      float WA = w * A;
      disp.x += Q * A * d.x * c;
      disp.z += Q * A * d.y * c;
      disp.y += A * s;
      nrm.x -= d.x * WA * c;
      nrm.z -= d.y * WA * c;
      nrm.y -= Q * WA * s;
      jxx -= Q * d.x * d.x * WA * s;
      jzz -= Q * d.y * d.y * WA * s;
      jxz -= Q * d.x * d.y * WA * s;
      freq *= uFreqMul;
      amp  *= uAmpMul;
    }
    WaveSample o;
    o.displacement = disp;
    o.normal = normalize(nrm);
    o.height = disp.y;
    o.fold = jxx * jzz - jxz * jxz;
    return o;
  }
`

const DETAIL_NORMAL = /* glsl */ `
  vec3 detailNormal(vec2 p, float t, float strength){
    vec2 g = vec2(0.0);
    float amp = 1.0;
    mat2 m = mat2(1.7, 1.1, -1.1, 1.7);
    vec2 flow = uWindDir * t * 0.6;
    for (int i = 0; i < 4; i++){
      vec3 n = noised(p + flow);
      g += amp * n.yz;
      p = m * p;
      flow = -flow * 0.85;
      amp *= 0.55;
    }
    return normalize(vec3(-g.x, 1.0 / max(strength, 1e-3), -g.y));
  }
`

export interface WaterApi {
	mesh: THREE.Mesh
	update(time: number): void
	/** Re-bake the coast distance field for a freshly generated world. */
	setWorld(tiles: HexTile[], offsetX: number, offsetZ: number): void
	dispose(): void
}

const COAST_RES = 256
const COAST_RANGE = 9 // world units of distance encoded in the field

function bakeCoastField(
	tiles: HexTile[],
	offsetX: number,
	offsetZ: number
): { data: Uint8Array; minX: number; minZ: number; sizeX: number; sizeZ: number } {
	const land = tiles.filter((t) => t.kind === 'LAND')
	let minX = Infinity
	let maxX = -Infinity
	let minZ = Infinity
	let maxZ = -Infinity
	for (const t of land) {
		const x = t.x + offsetX
		const z = t.z + offsetZ
		if (x < minX) minX = x
		if (x > maxX) maxX = x
		if (z < minZ) minZ = z
		if (z > maxZ) maxZ = z
	}
	const margin = COAST_RANGE + 2
	minX -= margin
	maxX += margin
	minZ -= margin
	maxZ += margin
	const sizeX = maxX - minX
	const sizeZ = maxZ - minZ

	const xs = land.map((t) => t.x + offsetX)
	const zs = land.map((t) => t.z + offsetZ)
	const data = new Uint8Array(COAST_RES * COAST_RES)
	for (let iy = 0; iy < COAST_RES; iy++) {
		const wz = minZ + ((iy + 0.5) / COAST_RES) * sizeZ
		for (let ix = 0; ix < COAST_RES; ix++) {
			const wx = minX + ((ix + 0.5) / COAST_RES) * sizeX
			let dmin = Infinity
			for (let i = 0; i < xs.length; i++) {
				const dx = wx - xs[i]
				const dz = wz - zs[i]
				const d2 = dx * dx + dz * dz
				if (d2 < dmin) dmin = d2
			}
			const d = Math.max(0, Math.sqrt(dmin) - 0.92)
			data[iy * COAST_RES + ix] = Math.round((Math.min(d, COAST_RANGE) / COAST_RANGE) * 255)
		}
	}
	return { data, minX, minZ, sizeX, sizeZ }
}

export function createWater(planeSize: number, surfaceY: number): WaterApi {
	const uniforms = {
		uTime: { value: 0 },
		uSunDir: { value: new THREE.Vector3(0.55, 0.7, 0.35).normalize() },
		uWindDir: { value: new THREE.Vector2(1.0, 0.55).normalize() },
		uWaveCount: { value: 16 },
		uBaseFreq: { value: (2 * Math.PI) / 16 }, // longest swell ~16 world units
		uAmplitude: { value: 0.05 },
		uChoppy: { value: 0.75 },
		uDirSpread: { value: 0.9 },
		uFreqMul: { value: 1.28 },
		uAmpMul: { value: 0.78 },
		uSpeed: { value: 0.6 },
		uSurfaceY: { value: surfaceY },

		uCoastTex: { value: null as THREE.DataTexture | null },
		uCoastMin: { value: new THREE.Vector2() },
		uCoastSize: { value: new THREE.Vector2(1, 1) },
		uCoastRange: { value: COAST_RANGE },

		uDeepColor: { value: new THREE.Color('#33808f') },
		uShallowColor: { value: new THREE.Color('#8fd6d8') },
		uFoamColor: { value: new THREE.Color('#fbfdf8') },
		uSkyColor: { value: new THREE.Color('#cde9ec') },
		uHorizonColor: { value: new THREE.Color('#a9d4d9') },
		uDetailScale: { value: 1.4 },
		uDetailStrength: { value: 0.22 },
		uShoreFoamWidth: { value: 1.1 },
		uFoamEdge: { value: 0.22 }
	}

	const material = new THREE.ShaderMaterial({
		uniforms,
		transparent: true,
		vertexShader: /* glsl */ `
			precision highp float;
			${NOISE}
			${GERSTNER}
			uniform float uSurfaceY;
			varying vec3 vWorldPos;
			varying vec3 vNormal;
			varying float vFold;
			varying float vHeight;
			void main(){
				vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
				worldPos.y = uSurfaceY;
				WaveSample w = sampleOcean(worldPos.xz);
				vec3 displaced = worldPos + w.displacement;
				vWorldPos = displaced;
				vNormal = w.normal;
				vFold = w.fold;
				vHeight = w.height;
				gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			precision highp float;
			uniform float uTime;
			uniform vec3  uSunDir;
			uniform vec2  uWindDir;
			uniform sampler2D uCoastTex;
			uniform vec2  uCoastMin;
			uniform vec2  uCoastSize;
			uniform float uCoastRange;
			uniform vec3  uDeepColor;
			uniform vec3  uShallowColor;
			uniform vec3  uFoamColor;
			uniform vec3  uSkyColor;
			uniform vec3  uHorizonColor;
			uniform float uDetailScale;
			uniform float uDetailStrength;
			uniform float uShoreFoamWidth;
			uniform float uFoamEdge;
			${NOISE}
			${DETAIL_NORMAL}
			varying vec3 vWorldPos;
			varying vec3 vNormal;
			varying float vFold;
			varying float vHeight;

			float fresnelF(float c, float f0){
				return f0 + (1.0 - f0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0);
			}
			float dggx(float NoH, float a){
				float a2 = a * a;
				float d = (NoH * a2 - NoH) * NoH + 1.0;
				return a2 / (3.14159265 * d * d);
			}
			float coastDist(vec2 xz){
				vec2 uv = (xz - uCoastMin) / uCoastSize;
				if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return uCoastRange;
				return texture2D(uCoastTex, uv).r * uCoastRange;
			}

			void main(){
				vec3 sunDir = normalize(uSunDir);
				vec3 V = normalize(cameraPosition - vWorldPos);
				float dist = length(cameraPosition - vWorldPos);

				// Gerstner normal + scrolling ripple cascades, fading with distance
				vec3 N = normalize(vNormal);
				float detFade = exp(-dist * 0.02);
				vec3 dN1 = detailNormal(vWorldPos.xz * uDetailScale, uTime, 1.0);
				vec2 dsum = dN1.xz * uDetailStrength * mix(0.5, 1.0, detFade);
				N = normalize(vec3(N.x + dsum.x, N.y, N.z + dsum.y));

				// depth proxy from the coast field: shallow turquoise near land,
				// deepening seaward (Beer-Lambert-flavoured ramp)
				float shoreD = coastDist(vWorldPos.xz);
				float depthT = 1.0 - exp(-shoreD * 0.55);
				vec3 waterCol = mix(uShallowColor, uDeepColor, depthT);

				// sky reflection via fresnel — pastel sky, warmer at the horizon
				float fres = fresnelF(max(dot(N, V), 0.0), 0.03);
				vec3 skyRefl = mix(uHorizonColor, uSkyColor, clamp(V.y * 1.6, 0.0, 1.0));
				vec3 color = mix(waterCol, skyRefl, fres * 0.85);

				// GGX sun glints
				vec3 H = normalize(V + sunDir);
				float rough = clamp(0.12 + (1.0 - detFade) * 0.12, 0.05, 0.5);
				float D = dggx(max(dot(N, H), 0.0), rough * rough);
				float fh = fresnelF(max(dot(H, V), 0.0), 0.02);
				color += vec3(1.0, 0.96, 0.86) * D * fh * max(dot(N, sunDir), 0.0) * 0.8;

				// ---- foam: shoreline band + breaking folds, layered dissolve ----
				float shore = smoothstep(uShoreFoamWidth, 0.06, shoreD);
				float sTex = fbm(vWorldPos.xz * 1.4 - uWindDir * uTime * 0.5, 3);
				float shoreFoam = shore * smoothstep(0.18, 0.5, sTex);
				// pulsing lap: a slow wave of foam rolling onto the shore
				float lap = 0.5 + 0.5 * sin(uTime * 1.1 - shoreD * 3.2);
				shoreFoam += smoothstep(0.35, 0.02, shoreD) * lap * 0.55;

				float breakE = smoothstep(0.65, 0.25, vFold);
				float energy = clamp(shoreFoam * 1.15 + breakE * 0.5, 0.0, 1.2);

				vec2 fp = vWorldPos.xz;
				vec2 flow = uWindDir * uTime * 0.35;
				float tCoarse = fbm(fp * 0.5 + flow, 3);
				float tFine   = fbm(fp * 2.1 - flow, 2);
				float tex = tCoarse * 0.62 + tFine * 0.38;
				float thr  = 1.0 - clamp(energy, 0.0, 1.0);
				float foam = smoothstep(thr - uFoamEdge, thr + uFoamEdge, tex);
				foam *= smoothstep(0.0, 0.12, energy);

				float bubbles = 0.8 + 0.28 * fbm(fp * 4.0 - flow, 2);
				vec3 foamCol = uFoamColor * bubbles * (0.7 + 0.35 * max(dot(N, sunDir), 0.0));
				color = mix(color, foamCol, clamp(foam, 0.0, 1.0) * 0.92);

				// distance haze toward the pastel horizon
				float fogAmt = 1.0 - exp(-dist * 0.012);
				color = mix(color, uSkyColor, clamp(fogAmt, 0.0, 1.0));

				// translucent shallows: the sandy beach skirts show through the
				// water near shore, then the sea turns opaque seaward. Foam and
				// distance stay solid.
				float alpha = mix(0.42, 1.0, smoothstep(0.1, 2.4, shoreD));
				alpha = max(alpha, foam * 0.95);
				alpha = max(alpha, clamp(fogAmt * 1.5, 0.0, 1.0));

				gl_FragColor = vec4(color, alpha);
			}
		`
	})

	const segments = 192
	const geo = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments)
	geo.rotateX(-Math.PI / 2)
	const mesh = new THREE.Mesh(geo, material)
	mesh.frustumCulled = false
	mesh.receiveShadow = false

	return {
		mesh,
		update(time: number): void {
			uniforms.uTime.value = time
		},
		setWorld(tiles: HexTile[], offsetX: number, offsetZ: number): void {
			const { data, minX, minZ, sizeX, sizeZ } = bakeCoastField(tiles, offsetX, offsetZ)
			uniforms.uCoastTex.value?.dispose()
			const tex = new THREE.DataTexture(
				data,
				COAST_RES,
				COAST_RES,
				THREE.RedFormat,
				THREE.UnsignedByteType
			)
			tex.magFilter = THREE.LinearFilter
			tex.minFilter = THREE.LinearFilter
			tex.needsUpdate = true
			uniforms.uCoastTex.value = tex
			uniforms.uCoastMin.value.set(minX, minZ)
			uniforms.uCoastSize.value.set(sizeX, sizeZ)
		},
		dispose(): void {
			geo.dispose()
			material.dispose()
			uniforms.uCoastTex.value?.dispose()
		}
	}
}
