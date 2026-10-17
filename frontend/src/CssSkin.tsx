export interface SkinTexture {
  url: string;
  model: "classic" | "slim";
}

function Cuboid({ texture, unit, x, y, width, height, depth, u, v, overlay = false }: {
  texture: SkinTexture; unit: number; x: number; y: number;
  width: number; height: number; depth: number; u: number; v: number;
  overlay?: boolean;
}) {
  const faces = [
    { name: "front", w: width, h: height, u: u + depth, v: v + depth, rotation: "", distance: depth / 2 },
    { name: "back", w: width, h: height, u: u + depth * 2 + width, v: v + depth, rotation: "rotateY(180deg)", distance: depth / 2 },
    { name: "right", w: depth, h: height, u: u + depth + width, v: v + depth, rotation: "rotateY(90deg)", distance: width / 2 },
    { name: "left", w: depth, h: height, u, v: v + depth, rotation: "rotateY(-90deg)", distance: width / 2 },
    { name: "top", w: width, h: depth, u: u + depth, v, rotation: "rotateX(90deg)", distance: height / 2 },
    { name: "bottom", w: width, h: depth, u: u + depth + width, v, rotation: "rotateX(-90deg)", distance: height / 2 },
  ];
  return <div className="skin-cube" style={{
    left: x * unit, top: y * unit, width: width * unit, height: height * unit,
    transform: overlay ? "scale3d(1.06, 1.04, 1.06)" : undefined,
  }}>
    {faces.map((face) => <div key={face.name} className={`skin-face skin-face-${face.name}`} style={{
      width: face.w * unit, height: face.h * unit,
      transform: `translate(-50%, -50%) ${face.rotation} translateZ(${face.distance * unit}px)`,
      backgroundImage: `url(${JSON.stringify(texture.url)})`,
      backgroundSize: `${64 * unit}px ${64 * unit}px`,
      backgroundPosition: `${-face.u * unit}px ${-face.v * unit}px`,
    }} />)}
  </div>;
}

export function CssSkin({ texture, name, compact }: { texture: SkinTexture; name: string; compact: boolean }) {
  const unit = compact ? 3.5 : 6;
  const arm = texture.model === "slim" ? 3 : 4;
  const parts = [
    { id: "head", x: 4, y: 0, width: 8, height: 8, depth: 8, u: 0, v: 0, outerU: 32, outerV: 0 },
    { id: "body", x: 4, y: 8, width: 8, height: 12, depth: 4, u: 16, v: 16, outerU: 16, outerV: 32 },
    { id: "right-arm", x: 4 - arm, y: 8, width: arm, height: 12, depth: 4, u: 40, v: 16, outerU: 40, outerV: 32 },
    { id: "left-arm", x: 12, y: 8, width: arm, height: 12, depth: 4, u: 32, v: 48, outerU: 48, outerV: 48 },
    { id: "right-leg", x: 4, y: 20, width: 4, height: 12, depth: 4, u: 0, v: 16, outerU: 0, outerV: 32 },
    { id: "left-leg", x: 8, y: 20, width: 4, height: 12, depth: 4, u: 16, v: 48, outerU: 0, outerV: 48 },
  ];
  return <div className="css-skin" role="img" aria-label={`Personnage 3D de ${name}, mode compatible`}>
    <div className="css-skin-model" style={{ width: 16 * unit, height: 32 * unit }}>
      {parts.map((part) => <Cuboid key={part.id} texture={texture} unit={unit} {...part} />)}
      {parts.map((part) =>
        <Cuboid key={`${part.id}-outer`} texture={texture} unit={unit} {...part} u={part.outerU} v={part.outerV} overlay />)}
    </div>
  </div>;
}
