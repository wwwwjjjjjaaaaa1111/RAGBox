type MaterialIconProps = {
  name: string;
  className?: string;
  filled?: boolean;
};

// 仅翻转 FILL 轴，其余轴与 index.css 保持一致，避免实心/空心图标字重不一致。
const FILLED_AXES = '"FILL" 1, "wght" 300, "GRAD" 0, "opsz" 20';

const MaterialIcon = ({ name, className, filled = false }: MaterialIconProps) => {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`.trim()}
      style={filled ? { fontVariationSettings: FILLED_AXES } : undefined}
      aria-hidden="true"
    >
      {name}
    </span>
  );
};

export default MaterialIcon;