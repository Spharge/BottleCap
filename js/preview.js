// preview.js — Three.js 3D preview of the bottle cap adapter

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { computeCap } from './scad.js';

let scene, camera, renderer, controls;
let adapterGroup = null;
let animationId = null;

const COLORS = {
    capA: 0x4a90d9,
    capB: 0xd97a4a,
    connector: 0x888888,
    threadA: 0x6ab0f0,
    threadB: 0xf09a6a,
};

/**
 * Initialize the Three.js scene in the given container element.
 */
export function initPreview(container) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 500);
    camera.position.set(40, 30, 40);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 200;

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(30, 50, 30);
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-20, 20, -20);
    scene.add(dirLight2);

    const grid = new THREE.GridHelper(80, 20, 0xcccccc, 0xe0e0e0);
    scene.add(grid);

    const axes = new THREE.AxesHelper(10);
    scene.add(axes);

    const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    animate();
}

function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

/**
 * Create a hollow cylinder (tube) mesh.
 */
function createTube(innerR, outerR, height, color, opacity = 0.7) {
    const shape = new THREE.Shape();
    const segs = 64;

    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * outerR;
        const y = Math.sin(a) * outerR;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }

    const hole = new THREE.Path();
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * innerR;
        const y = Math.sin(a) * innerR;
        if (i === 0) hole.moveTo(x, y);
        else hole.lineTo(x, y);
    }
    shape.holes.push(hole);

    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
    });

    const mat = new THREE.MeshPhongMaterial({
        color,
        transparent: opacity < 1.0,
        opacity,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}

/**
 * Create helical thread geometry.
 * wall_overlap extends threads into the wall for solid union in STL export.
 */
function createHelicalThreads(bore_r, lead, starts, depth, threadWidth, engage_h, pitch, color) {
    const group = new THREE.Group();
    const segsPerTurn = 48;
    const turns = engage_h / lead;
    const totalSegs = Math.ceil(segsPerTurn * turns);
    const wall_overlap = 1.0; // extend into wall for solid mesh

    const mat = new THREE.MeshPhongMaterial({
        color,
        side: THREE.DoubleSide,
    });

    for (let s = 0; s < starts; s++) {
        const startAngle = s * 2 * Math.PI / starts;
        const vertices = [];
        const indices = [];

        for (let i = 0; i <= totalSegs; i++) {
            const angle = startAngle + i * 2 * Math.PI / segsPerTurn;
            const z = pitch + i * lead / segsPerTurn;

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            const ri = bore_r - depth;
            const ro = bore_r + wall_overlap; // extend past bore into wall

            // 4 vertices per segment step: inner-bottom, outer-bottom, inner-top, outer-top
            vertices.push(ri * cosA, z, ri * sinA);
            vertices.push(ro * cosA, z, ro * sinA);
            vertices.push(ri * cosA, z + threadWidth, ri * sinA);
            vertices.push(ro * cosA, z + threadWidth, ro * sinA);

            if (i < totalSegs) {
                const base = i * 4;
                const next = (i + 1) * 4;

                // Bottom face
                indices.push(base, base + 1, next);
                indices.push(next, base + 1, next + 1);

                // Top face
                indices.push(base + 2, next + 2, base + 3);
                indices.push(next + 2, next + 3, base + 3);

                // Inner face
                indices.push(base, next, base + 2);
                indices.push(next, next + 2, base + 2);

                // Outer face
                indices.push(base + 1, base + 3, next + 1);
                indices.push(next + 1, base + 3, next + 3);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        group.add(new THREE.Mesh(geom, mat));
    }

    return group;
}

/**
 * Update the 3D preview with new parameters.
 */
export function updatePreview(bottleA, bottleB, clearance, connectorH) {
    if (adapterGroup) {
        scene.remove(adapterGroup);
        adapterGroup.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }

    adapterGroup = new THREE.Group();

    const ca = computeCap(bottleA, clearance);
    const cb = computeCap(bottleB, clearance);

    const conn_r = Math.max(ca.outer_r, cb.outer_r);
    const flow_r = Math.min(ca.bore_r, cb.bore_r);
    const a_cap_h = ca.engage_h + 2.0;
    const b_cap_h = cb.engage_h + 2.0;
    const total_h = a_cap_h + connectorH + b_cap_h;

    const offsetY = -total_h / 2;

    // Cap A shell
    const capAMesh = createTube(ca.bore_r, ca.outer_r, a_cap_h, COLORS.capA, 0.6);
    capAMesh.position.y = offsetY;
    adapterGroup.add(capAMesh);

    // Cap A threads
    const threadsA = createHelicalThreads(
        ca.bore_r, ca.lead, ca.starts, ca.depth,
        ca.thread_width, ca.engage_h, ca.pitch, COLORS.threadA
    );
    threadsA.position.y = offsetY;
    adapterGroup.add(threadsA);

    // Connector
    const connMesh = createTube(flow_r, conn_r, connectorH, COLORS.connector, 0.7);
    connMesh.position.y = offsetY + a_cap_h;
    adapterGroup.add(connMesh);

    // Cap B shell (flipped)
    const capBMesh = createTube(cb.bore_r, cb.outer_r, b_cap_h, COLORS.capB, 0.6);
    capBMesh.position.y = offsetY + a_cap_h + connectorH + b_cap_h;
    capBMesh.rotation.x = Math.PI / 2;
    adapterGroup.add(capBMesh);

    // Cap B threads (flipped)
    const threadsB = createHelicalThreads(
        cb.bore_r, cb.lead, cb.starts, cb.depth,
        cb.thread_width, cb.engage_h, cb.pitch, COLORS.threadB
    );
    threadsB.scale.y = -1;
    threadsB.position.y = offsetY + a_cap_h + connectorH + b_cap_h;
    adapterGroup.add(threadsB);

    scene.add(adapterGroup);

    const dist = Math.max(total_h, conn_r * 2) * 2.2;
    camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    controls.target.set(0, 0, 0);
    controls.update();

    return { total_h, a_cap_h, b_cap_h, conn_r, flow_r };
}

/**
 * Export the current adapter geometry as a binary STL file.
 * Returns a Blob, or null if no adapter is loaded.
 */
export function exportSTL() {
    if (!adapterGroup) return null;

    // Clone the group and make all materials opaque for export
    const exportGroup = adapterGroup.clone();
    exportGroup.traverse((obj) => {
        if (obj.material) {
            obj.material = obj.material.clone();
            obj.material.transparent = false;
            obj.material.opacity = 1.0;
        }
    });

    // Apply all transforms to geometry so the STL has correct positions
    exportGroup.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const stlBuffer = exporter.parse(exportGroup, { binary: true });

    // Clean up cloned materials
    exportGroup.traverse((obj) => {
        if (obj.material) obj.material.dispose();
    });

    return new Blob([stlBuffer], { type: 'application/octet-stream' });
}
