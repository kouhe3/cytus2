"""Extension modules that add entity families to the canonical DB.

Each module in this package exposes ``build(source) -> dict[str, list[record]]``.
``entities.build_entities`` discovers them with ``pkgutil`` so ticket branches
can add a module without editing a shared registry.
"""
