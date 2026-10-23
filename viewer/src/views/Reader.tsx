import type { ExtraContent, ImContent, IndexData, Lang, OsContent } from "../types";
import type { ArchiveFilters } from "../rows";
import { BranchingReader } from "./BranchingReader";
import { GalleryReader } from "./GalleryReader";
import { ArchiveSummary, Overview } from "./ArchiveSummary";
import { ExtrasReader } from "./ExtrasReader";
import { GateReader } from "./GateReader";
import { ImReader } from "./ImReader";
import { OaReader } from "./OaReader";
import { OsReader } from "./OsReader";
import { PackReader } from "./PackReader";

export interface ReaderProps {
  index: IndexData;
  lang: Lang;
  view: string;
  id: string;
  im?: ImContent;
  os?: OsContent;
  extra?: ExtraContent;
  loadingIm: boolean;
  loadingOs: boolean;
  loadingExtra: boolean;
  onNavigate: (view: string, id?: string) => void;
  filters: ArchiveFilters;
  onFilter: (patch: Partial<ArchiveFilters>) => void;
}

export function Reader(props: ReaderProps) {
  const { index, view, id, lang, onNavigate } = props;
  const osMeta = id ? index.os.find((e) => e.id === id) : undefined;
  const imMeta = id ? index.im.find((t) => t.id === id) : undefined;

  if (osMeta) {
    return (
      <OsReader
        index={index}
        lang={lang}
        meta={osMeta}
        text={props.os?.os[osMeta.id]}
        loading={props.loadingOs}
        onNavigate={onNavigate}
        onFilter={props.onFilter}
      />
    );
  }
  if (imMeta) {
    return (
      <ImReader
        index={index}
        lang={lang}
        meta={imMeta}
        text={props.im?.im[imMeta.id]}
        loading={props.loadingIm}
        onNavigate={onNavigate}
      />
    );
  }
  if (!id) {
    if (view === "timeline") {
      return (
        <ArchiveSummary
          index={index}
          lang={lang}
          filters={props.filters}
          onNavigate={onNavigate}
          onFilter={props.onFilter}
        />
      );
    }
    return <Overview index={index} />;
  }

  switch (view) {
    case "packs":
      return <PackReader index={index} lang={lang} packId={id} onNavigate={onNavigate} />;
    case "gates":
      return <GateReader index={index} lang={lang} gateId={id} onNavigate={onNavigate} />;
    case "oa":
      return (
        <OaReader
          index={index}
          lang={lang}
          character={id}
          extra={props.extra}
          loading={props.loadingExtra}
          onNavigate={onNavigate}
        />
      );
    case "backup":
      return <GalleryReader index={index} lang={lang} folderId={id} onNavigate={onNavigate} />;
    case "branching":
      return (
        <BranchingReader
          index={index}
          lang={lang}
          nodeId={id}
          extra={props.extra}
          loading={props.loadingExtra}
          onNavigate={onNavigate}
        />
      );
    case "extras":
      return (
        <ExtrasReader
          index={index}
          section={id}
          extra={props.extra}
          loading={props.loadingExtra}
          lang={props.lang}
          onNavigate={onNavigate}
        />
      );
    default:
      return <Overview index={index} />;
  }
}
