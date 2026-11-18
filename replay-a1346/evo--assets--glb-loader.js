window.makeJ150Parser = function(renderer) {
  function accessorComponentCount(type) {
    return { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type] || 1;
  }

  function accessorByteSize(componentType) {
    return { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[componentType];
  }

  function arrayTypeForAccessor(componentType) {
    return {
      5120: Int8Array,
      5121: Uint8Array,
      5122: Int16Array,
      5123: Uint16Array,
      5125: Uint32Array,
      5126: Float32Array
    }[componentType];
  }

  function accessorArray(json, arrayBuffer, binStart, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferView];
    const offset = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const itemSize = accessorComponentCount(accessor.type);
    const ArrayType = arrayTypeForAccessor(accessor.componentType);
    const byteSize = accessorByteSize(accessor.componentType);
    const expectedStride = itemSize * byteSize;
    const stride = view.byteStride || expectedStride;
    const length = accessor.count * itemSize;

    if (stride === expectedStride) {
      return new ArrayType(arrayBuffer, offset, length);
    }

    const source = new DataView(arrayBuffer, offset, accessor.count * stride);
    const output = new ArrayType(length);
    for (let row = 0; row < accessor.count; row += 1) {
      for (let column = 0; column < itemSize; column += 1) {
        const sourceOffset = row * stride + column * byteSize;
        const targetIndex = row * itemSize + column;
        if (accessor.componentType === 5126) output[targetIndex] = source.getFloat32(sourceOffset, true);
        if (accessor.componentType === 5125) output[targetIndex] = source.getUint32(sourceOffset, true);
        if (accessor.componentType === 5123) output[targetIndex] = source.getUint16(sourceOffset, true);
        if (accessor.componentType === 5122) output[targetIndex] = source.getInt16(sourceOffset, true);
        if (accessor.componentType === 5121) output[targetIndex] = source.getUint8(sourceOffset);
        if (accessor.componentType === 5120) output[targetIndex] = source.getInt8(sourceOffset);
      }
    }
    return output;
  }

  function textureFromBufferView(json, arrayBuffer, binStart, imageIndex) {
    const image = json.images?.[imageIndex];
    if (!image || image.bufferView === undefined) return Promise.resolve(null);
    const bufferView = json.bufferViews[image.bufferView];
    const start = binStart + (bufferView.byteOffset || 0);
    const blob = new Blob(
      [arrayBuffer.slice(start, start + bufferView.byteLength)],
      { type: image.mimeType || "image/jpeg" }
    );
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          URL.revokeObjectURL(url);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
          resolve(texture);
        },
        undefined,
        (error) => {
          URL.revokeObjectURL(url);
          reject(error);
        }
      );
    });
  }

  function applyNodeTransform(object, node) {
    if (node.matrix) {
      object.matrix.fromArray(node.matrix);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      return;
    }
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
  }

  function createPrimitiveGeometry(json, arrayBuffer, binStart, primitive) {
    const geometry = new THREE.BufferGeometry();
    const positionAccessor = json.accessors[primitive.attributes.POSITION];
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        accessorArray(json, arrayBuffer, binStart, primitive.attributes.POSITION),
        3,
        !!positionAccessor.normalized
      )
    );

    if (primitive.attributes.NORMAL !== undefined) {
      const accessor = json.accessors[primitive.attributes.NORMAL];
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(
          accessorArray(json, arrayBuffer, binStart, primitive.attributes.NORMAL),
          3,
          !!accessor.normalized
        )
      );
    }

    if (primitive.attributes.TEXCOORD_0 !== undefined) {
      const accessor = json.accessors[primitive.attributes.TEXCOORD_0];
      geometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          accessorArray(json, arrayBuffer, binStart, primitive.attributes.TEXCOORD_0),
          2,
          !!accessor.normalized
        )
      );
    }

    if (primitive.indices !== undefined) {
      const accessor = json.accessors[primitive.indices];
      geometry.setIndex(
        new THREE.BufferAttribute(
          accessorArray(json, arrayBuffer, binStart, primitive.indices),
          1,
          !!accessor.normalized
        )
      );
    }

    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  async function parseSimpleGlb(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Invalid GLB file");
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLength)));
    const binHeader = 20 + jsonLength;
    const binLength = view.getUint32(binHeader, true);
    const binStart = binHeader + 8;
    if (!binLength) throw new Error("GLB binary data is missing");

    const textures = await Promise.all((json.textures || []).map((texture) =>
      textureFromBufferView(json, arrayBuffer, binStart, texture.source).catch(() => null)
    ));

    const materials = (json.materials || []).map((materialDefinition) => {
      const pbr = materialDefinition.pbrMetallicRoughness || {};
      const map = pbr.baseColorTexture?.index !== undefined ? textures[pbr.baseColorTexture.index] : null;
      const factor = pbr.baseColorFactor || [1, 1, 1, 1];
      const material = new THREE.MeshStandardMaterial({
        name: materialDefinition.name || "",
        map,
        color: new THREE.Color(factor[0], factor[1], factor[2]),
        roughness: pbr.roughnessFactor ?? 0.74,
        metalness: pbr.metallicFactor ?? 1,
        // CAD tessellation can contain mixed winding; double-sided display keeps
        // mirrored arms visible in the browser while preserving the source mesh.
        side: THREE.DoubleSide
      });
      if (materialDefinition.alphaMode === 'BLEND') {
        material.transparent = true;
        material.opacity = factor[3];
      }
      if (materialDefinition.alphaMode === 'MASK') {
        material.alphaTest = materialDefinition.alphaCutoff ?? 0.5;
        material.opacity = factor[3];
      }
      if (materialDefinition.emissiveFactor) material.emissive.fromArray(materialDefinition.emissiveFactor);
      return material;
    });

    const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e2e6, roughness: 0.78 });
    const geometryCache = new Map();
    const sceneGroup = new THREE.Group();

    function createMeshObject(meshIndex) {
      const definition = json.meshes[meshIndex];
      const group = new THREE.Group();
      definition.primitives.forEach((primitive, index) => {
        const cacheKey = `${meshIndex}:${index}`;
        let geometry = geometryCache.get(cacheKey);
        if (!geometry) {
          geometry = createPrimitiveGeometry(json, arrayBuffer, binStart, primitive);
          geometryCache.set(cacheKey, geometry);
        }
        const mesh = new THREE.Mesh(geometry, materials[primitive.material] || defaultMaterial);
        mesh.frustumCulled = false;
        group.add(mesh);
      });
      return group.children.length === 1 ? group.children[0] : group;
    }

    function buildNode(index) {
      const definition = json.nodes[index];
      const node = new THREE.Group();
      node.name = definition.name || `node_${index}`;
      // Preserve CAD metadata so the viewer can present stable part labels.
      node.userData.cad = definition.extras || {};
      applyNodeTransform(node, definition);
      if (definition.mesh !== undefined) node.add(createMeshObject(definition.mesh));
      (definition.children || []).forEach((childIndex) => node.add(buildNode(childIndex)));
      return node;
    }

    const sceneDefinition = json.scenes?.[json.scene || 0];
    const rootNodes = sceneDefinition?.nodes || json.nodes.map((_, index) => index);
    rootNodes.forEach((index) => sceneGroup.add(buildNode(index)));
    return sceneGroup;
  }


return parseSimpleGlb;
};
