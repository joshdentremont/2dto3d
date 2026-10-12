// 3D preview: the parts on a print bed, with orbit / zoom / pan controls.
(function (L3D) {
  'use strict';

  function createViewer(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -160, 140);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x666670, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(0.6, -1, 1.6);
    scene.add(sun);

    let bed = null;
    const group = new THREE.Group();
    scene.add(group);
    let lastSize = 0;

    function setBed(size) {
      if (bed) { scene.remove(bed); bed.geometry.dispose(); bed.material.dispose(); }
      const span = Math.max(100, Math.ceil(size * 1.4 / 10) * 10);
      bed = new THREE.GridHelper(span, span / 10, 0x8a8a96, 0x8a8a96);
      bed.material.transparent = true;
      bed.material.opacity = 0.35;
      bed.rotation.x = Math.PI / 2;
      scene.add(bed);
    }

    // parts: [{ color: '#RRGGBB', mesh: { positions, indices } }]
    function setParts(parts) {
      for (const child of group.children.slice()) {
        group.remove(child);
        child.geometry.dispose();
        child.material.dispose();
      }
      for (const part of parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(part.color), flatShading: true, roughness: 0.75, metalness: 0,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
        group.add(new THREE.Mesh(geo, mat));
      }
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z);
        if (!bed || Math.abs(longest - lastSize) > lastSize * 0.2) {
          setBed(Math.max(size.x, size.y));
          const d = longest * 2.1 + 20;
          const c = box.getCenter(new THREE.Vector3());
          controls.target.set(c.x, c.y, 0);
          camera.position.set(c.x, c.y - d * 0.75, d * 0.75);
          controls.update();
          lastSize = longest;
        }
      }
      render();
    }

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }

    function render() {
      renderer.render(scene, camera);
    }

    new ResizeObserver(resize).observe(container);
    resize();
    return { setParts };
  }

  L3D.viewer = { createViewer };
})(globalThis.L3D = globalThis.L3D || {});
