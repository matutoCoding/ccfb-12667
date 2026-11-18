// WebGL2 渲染器：三角网格 + 折弯线高亮 + 轨道相机
import { multiply4, perspective, lookAt, identity4, type Mat4 } from './mesh';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;

export interface OrbitState {
  yaw: number;     // 绕 Z
  pitch: number;   // 俯仰
  distance: number;
  target: { x: number; y: number; z: number };
}

export class GLRenderer {
  gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private colorBuf: WebGLBuffer;
  private idxBuf: WebGLBuffer;
  private lineVao: WebGLVertexArrayObject;
  private linePosBuf: WebGLBuffer;
  private lineColorBuf: WebGLBuffer;
  private uMVP: WebGLUniformLocation;
  private vertexCount = 0;
  private indexCount = 0;
  private lineCount = 0;
  orbit: OrbitState = { yaw: -Math.PI / 2, pitch: 0.6, distance: 400, target: { x: 0, y: 0, z: 0 } };
  private drag: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.program = this.createProgram(VERT, FRAG);
    this.uMVP = gl.getUniformLocation(this.program, 'uMVP')!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer()!;
    this.colorBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.linePosBuf = gl.createBuffer()!;
    this.lineColorBuf = gl.createBuffer()!;
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuf);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.clearColor(0.07, 0.09, 0.12, 1);
    gl.enable(gl.DEPTH_TEST);
    this.attachControls(canvas);
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  private attachControls(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.orbit.yaw += dx * 0.01;
      this.orbit.pitch = Math.max(-1.4, Math.min(1.4, this.orbit.pitch + dy * 0.01));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { this.drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.distance = Math.max(30, Math.min(3000, this.orbit.distance * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
  }

  frameTarget(cx: number, cy: number, extent: number): void {
    this.orbit.target = { x: cx, y: cy, z: 0 };
    this.orbit.distance = Math.max(120, extent * 1.6);
  }

  private mvp(): Mat4 {
    const { yaw, pitch, distance, target } = this.orbit;
    const eye = {
      x: target.x + distance * Math.cos(pitch) * Math.cos(yaw),
      y: target.y + distance * Math.cos(pitch) * Math.sin(yaw),
      z: target.z + distance * Math.sin(pitch),
    };
    const view = lookAt(eye, target);
    const proj = perspective(Math.PI / 5, this.gl.canvas.width / Math.max(1, this.gl.canvas.height), 1, 8000);
    return multiply4(proj, view);
  }

  /** 更新实体网格（顶点 + 每顶点颜色 + 索引） */
  updateMesh(vertices: Float32Array, colors: Float32Array, indices: Uint32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    this.vertexCount = vertices.length / 3;
    this.indexCount = indices.length;
  }

  /** 更新线段（位置 xyz 数组 + 颜色 rgb 数组，每 2 个顶点一条线） */
  updateLines(positions: Float32Array, colors: Float32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    this.lineCount = positions.length / 3;
  }

  render(): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = this.mvp();
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMVP, false, mvp.m);

    gl.bindVertexArray(this.vao);
    if (this.indexCount > 0) gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    gl.bindVertexArray(this.lineVao);
    if (this.lineCount > 0) {
      gl.lineWidth(2);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
    }
    void this.vertexCount;
  }

  resetView(): void {
    this.orbit.yaw = -Math.PI / 2;
    this.orbit.pitch = 0.6;
  }
}

export function flatColorArray(count: number, rgb: [number, number, number]): Float32Array {
  const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    a[i * 3] = rgb[0]; a[i * 3 + 1] = rgb[1]; a[i * 3 + 2] = rgb[2];
  }
  return a;
}

export function identityColor(count: number): Float32Array {
  return flatColorArray(count, [0.62, 0.72, 0.82]);
}

export const IDENTITY4 = identity4;
