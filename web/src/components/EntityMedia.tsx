import { MediaImage } from "./Media";
import {
  isGalleryItem,
  isIllustration,
  isImReply,
  isImPost,
  isSong,
  recordOf,
} from "../data/database";
import type { BaseEntity } from "../types";

export function EntityMedia({ entity }: { readonly entity: BaseEntity }) {
  if (isIllustration(entity)) {
    const key = entity.asset_id.split("/").pop() ?? entity.game_id;
    return (
      <div className="entity-media">
        <MediaImage
          id={key}
          kind="illustration"
          alt={entity.game_id}
          className="entity-illustration"
        />
      </div>
    );
  }
  if (isImReply(entity)) {
    return (
      <div className="entity-media post-media">
        <MediaImage
          id={entity.avatar}
          kind="avatar"
          alt={entity.author}
          className="post-avatar"
        />
      </div>
    );
  }
  if (isImPost(entity)) {
    return (
      <div className="entity-media post-media">
        <MediaImage
          id={entity.avatar}
          kind="avatar"
          alt={entity.author}
          className="post-avatar"
        />
        {entity.attachments.map((id) => (
          <MediaImage
            key={id}
            id={id}
            kind="image"
            alt={id}
            className="post-attachment"
          />
        ))}
      </div>
    );
  }
  if (isSong(entity)) {
    return (
      <div className="entity-media">
        <MediaImage
          id={entity.game_id}
          kind="viewer"
          alt={entity.name ?? entity.game_id}
          className="song-cover"
        />
      </div>
    );
  }
  if (isGalleryItem(entity)) {
    const data = recordOf(entity);
    const location = String(data["location"] ?? "");
    if (!location || String(data["kind"] ?? "") !== "image") {
      return null;
    }
    return (
      <div className="entity-media">
        <MediaImage
          id={location}
          kind="image"
          alt={String(data["name"] ?? location)}
          className="gallery-image"
        />
      </div>
    );
  }
  return null;
}
