"""Page builders discovered by ``wiki.build.build_page_models``.

Each module exposes ``build(db: Database) -> list[PageModel]``.  New page types
land as a module here plus a profile overlay under ``wiki/profiles/bili.d`` so
parallel tickets never edit a shared registry.
"""
