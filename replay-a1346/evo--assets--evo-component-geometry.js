/* Approved local part geometry uses Blender world coordinates in metres. */
window.applyEvoComponentGeometry = function(root, entries, findObjects) {
  root.updateMatrixWorld(true);
  const missing = [];
  for (const entry of entries) {
    const objects = findObjects(entry.object_name);
    if (!objects.length) {
      missing.push(entry.object_name);
      continue;
    }
    for (const object of objects) {
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        const inverse = mesh.matrixWorld.clone().invert();
        const positions = new Float32Array(entry.vertices_blender_m.length * 3);
        const point = new THREE.Vector3();
        entry.vertices_blender_m.forEach(([x, y, z], index) => {
          point.set(x, z, -y).applyMatrix4(inverse).toArray(positions, index * 3);
        });
        const indices = [];
        for (const face of entry.faces) {
          for (let index = 1; index + 1 < face.length; index += 1) {
            indices.push(face[0], face[index], face[index + 1]);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        mesh.geometry = geometry;
        mesh.visible = true;
        mesh.userData.geometryReviewNote = entry.reason;
      });
    }
  }
  return missing;
};
