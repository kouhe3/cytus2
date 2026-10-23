"""Validation against the hand-written JSON Schemas in ``schema/``.

The validator intentionally implements only the JSON Schema keywords the
project actually uses. An unsupported validation keyword is a hard error, so
a schema and this validator cannot drift apart silently.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .errors import BuildError

DEFAULT_SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schema"

_META_KEYWORDS = {
    "$schema",
    "$id",
    "$defs",
    "definitions",
    "title",
    "description",
    "default",
    "examples",
    "deprecated",
    "readOnly",
    "$comment",
    "format",
}

_SUPPORTED_KEYWORDS = {
    "$ref",
    "type",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "uniqueItems",
    "enum",
    "const",
    "pattern",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "anyOf",
    "oneOf",
    "allOf",
}


class SchemaError(BuildError):
    """The schema directory is missing, malformed or uses an unsupported keyword."""


class SchemaValidator:
    def __init__(self, schema_dir: Path | str | None = None) -> None:
        self.schema_dir = Path(schema_dir) if schema_dir is not None else DEFAULT_SCHEMA_DIR
        self._documents: dict[str, dict[str, Any]] = {}

    def load(self, name: str) -> dict[str, Any]:
        if name not in self._documents:
            path = self.schema_dir / name
            try:
                self._documents[name] = json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise SchemaError(f"missing schema file: {path}") from exc
            except json.JSONDecodeError as exc:
                raise SchemaError(f"invalid JSON in schema {path}: {exc}") from exc
        return self._documents[name]

    def schema(self, entity_type: str) -> dict[str, Any]:
        return self.load(f"{entity_type}.schema.json")

    def errors(self, entity_type: str, record: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        self._check(record, self.schema(entity_type), "$", f"{entity_type}.schema.json", errors)
        return errors

    def _resolve(self, reference: str, current_document: str) -> tuple[dict[str, Any], str]:
        document_name, separator, pointer = reference.partition("#")
        document_name = document_name or current_document
        document = self.load(document_name)
        node: Any = document
        if separator:
            if not pointer.startswith("/"):
                raise SchemaError(f"unsupported $ref pointer: {reference}")
            for raw_token in pointer[1:].split("/"):
                token = raw_token.replace("~1", "/").replace("~0", "~")
                if not isinstance(node, dict) or token not in node:
                    raise SchemaError(f"unresolvable $ref: {reference}")
                node = node[token]
        if not isinstance(node, dict):
            raise SchemaError(f"$ref does not point at a schema object: {reference}")
        return node, document_name

    def _check(
        self,
        value: Any,
        schema: dict[str, Any],
        path: str,
        document_name: str,
        errors: list[str],
    ) -> None:
        if not isinstance(schema, dict):
            raise SchemaError(f"schema node at {path} is not an object")
        for keyword in schema:
            if keyword in _META_KEYWORDS or keyword in _SUPPORTED_KEYWORDS:
                continue
            raise SchemaError(f"unsupported JSON Schema keyword {keyword!r} in {document_name}")

        if "$ref" in schema:
            target, target_document = self._resolve(schema["$ref"], document_name)
            self._check(value, target, path, target_document, errors)

        declared_type = schema.get("type")
        if declared_type is not None:
            allowed = declared_type if isinstance(declared_type, list) else [declared_type]
            if not any(self._type_matches(value, name) for name in allowed):
                errors.append(
                    f"{path}: expected type {'/'.join(allowed)}, got {type(value).__name__}"
                )
                return

        if "enum" in schema and not any(
            self._json_equal(value, option) for option in schema["enum"]
        ):
            errors.append(f"{path}: value {value!r} is not one of {schema['enum']!r}")

        if "const" in schema and not self._json_equal(value, schema["const"]):
            errors.append(f"{path}: expected {schema['const']!r}, got {value!r}")

        for keyword in ("allOf", "anyOf", "oneOf"):
            if keyword not in schema:
                continue
            branches = schema[keyword]
            branch_errors = []
            for branch in branches:
                local: list[str] = []
                self._check(value, branch, path, document_name, local)
                branch_errors.append(local)
            passing = sum(1 for local in branch_errors if not local)
            if keyword == "allOf":
                for local in branch_errors:
                    errors.extend(local)
            elif keyword == "anyOf" and passing == 0:
                errors.extend(branch_errors[0])
            elif keyword == "oneOf" and passing != 1:
                errors.append(f"{path}: must match exactly one oneOf branch, matched {passing}")

        if isinstance(value, str):
            self._check_string(value, schema, path, errors)
        elif isinstance(value, dict):
            self._check_object(value, schema, path, document_name, errors)
        elif isinstance(value, list):
            self._check_array(value, schema, path, document_name, errors)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            minimum = schema.get("minimum")
            maximum = schema.get("maximum")
            if minimum is not None and value < minimum:
                errors.append(f"{path}: {value!r} is less than minimum {minimum!r}")
            if maximum is not None and value > maximum:
                errors.append(f"{path}: {value!r} is greater than maximum {maximum!r}")

    def _check_string(
        self, value: str, schema: dict[str, Any], path: str, errors: list[str]
    ) -> None:
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match pattern {schema['pattern']!r}")
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: shorter than {schema['minLength']} characters")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']} characters")

    def _check_object(
        self,
        value: dict[str, Any],
        schema: dict[str, Any],
        path: str,
        document_name: str,
        errors: list[str],
    ) -> None:
        for name in schema.get("required", []):
            if name not in value:
                errors.append(f"{path}: missing required property {name!r}")

        properties = schema.get("properties", {})
        for name, item in value.items():
            child_path = f"{path}.{name}"
            if name in properties:
                self._check(item, properties[name], child_path, document_name, errors)
                continue
            additional = schema.get("additionalProperties", True)
            if additional is False:
                errors.append(f"{path}: unexpected property {name!r}")
            elif isinstance(additional, dict):
                self._check(item, additional, child_path, document_name, errors)
            elif additional is not True:
                raise SchemaError(
                    f"additionalProperties must be a boolean or schema in {document_name}"
                )

    def _check_array(
        self,
        value: list[Any],
        schema: dict[str, Any],
        path: str,
        document_name: str,
        errors: list[str],
    ) -> None:
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if schema.get("uniqueItems"):
            seen = set()
            for item in value:
                marker = json.dumps(item, sort_keys=True, ensure_ascii=False)
                if marker in seen:
                    errors.append(f"{path}: duplicate item {item!r}")
                    break
                seen.add(marker)
        items = schema.get("items")
        if items is not None:
            if not isinstance(items, dict):
                raise SchemaError(f"items must be a schema object in {document_name}")
            for index, item in enumerate(value):
                self._check(item, items, f"{path}[{index}]", document_name, errors)

    @staticmethod
    def _type_matches(value: Any, name: str) -> bool:
        if name == "object":
            return isinstance(value, dict)
        if name == "array":
            return isinstance(value, list)
        if name == "string":
            return isinstance(value, str)
        if name == "boolean":
            return isinstance(value, bool)
        if name == "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        if name == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if name == "null":
            return value is None
        raise SchemaError(f"unsupported JSON Schema type {name!r}")

    @staticmethod
    def _json_equal(left: Any, right: Any) -> bool:
        if isinstance(left, bool) or isinstance(right, bool):
            return isinstance(left, bool) and isinstance(right, bool) and left == right
        return left == right
