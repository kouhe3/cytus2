import { MEDIA_BASE, useManifest } from "../media";

export function Avatar({ id, size = 28, name }: { id: string; size?: number; name?: string }) {
  const manifest = useManifest();
  // 备份数据库（gallerydata/folder 的 AvatarId）用 galleryicons 的角色图标
  const entry = manifest?.avatars?.[id] ?? manifest?.galleryIcons?.[id];
  const style = { width: size, height: size } as const;
  if (!entry) {
    return (
      <span className="avatar avatar--empty" style={style} title={`${name ?? ""} ${id}`.trim()} aria-hidden="true">
        {(name ?? id).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="avatar"
      style={style}
      src={MEDIA_BASE + encodeURI(entry.file)}
      alt={name ?? id}
      title={id}
      loading="lazy"
    />
  );
}
