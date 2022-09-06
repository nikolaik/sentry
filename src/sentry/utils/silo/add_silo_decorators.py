from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable, Dict, Iterable, Optional

from sentry.utils import json
from sentry.utils.silo.common import (
    ClassCategory,
    Keywords,
    apply_decorators,
    has_control_name,
    has_customer_name,
)


def add_silo_decorators(
    silo_keywords: Dict[str, Keywords],
    path_name: Optional[str] = "./src/sentry",
):
    classes = _read_audit()

    def execute(
        decorator_name: str,
        import_stmt: str,
        category: ClassCategory,
        predicate: Callable[[TargetClass], bool],
        path_name: str,
    ) -> None:
        filtered_targets = (
            (c.module, c.name)
            for c in classes
            if c.category == category and not c.is_decorated and predicate(c)
        )
        apply_decorators(decorator_name, import_stmt, filtered_targets, path_name)

    ####################################################################
    # Fill these predicates in with the logic you want to apply

    def customer_model_predicate(c: TargetClass) -> bool:
        return False  # For now, rely on decorate_models_by_relation instead

    def control_model_predicate(c: TargetClass) -> bool:
        return False  # For now, rely on decorate_models_by_relation instead

    def customer_endpoint_predicate(c: TargetClass) -> bool:
        return has_customer_name(c.name, silo_keywords)

    def control_endpoint_predicate(c: TargetClass) -> bool:
        return has_control_name(c.name, silo_keywords)

    ####################################################################

    execute(
        "customer_silo_model",
        "from sentry.db.models import customer_silo_model",
        ClassCategory.MODEL,
        customer_model_predicate,
        path_name,
    )
    execute(
        "control_silo_model",
        "from sentry.db.models import control_silo_model",
        ClassCategory.MODEL,
        control_model_predicate,
        path_name,
    )
    execute(
        "customer_silo_endpoint",
        "from sentry.api.base import customer_silo_endpoint",
        ClassCategory.ENDPOINT,
        customer_endpoint_predicate,
        path_name,
    )
    execute(
        "control_silo_endpoint",
        "from sentry.api.base import control_silo_endpoint",
        ClassCategory.ENDPOINT,
        control_endpoint_predicate,
        path_name,
    )


@dataclass
class TargetClass:
    module: str
    name: str
    category: ClassCategory
    is_decorated: bool


def _parse_audit(audit) -> Iterable[TargetClass]:
    def split_qualname(value):
        dot_index = value.rindex(".")
        module = value[:dot_index]
        name = value[dot_index + 1 :]
        return module, name

    def parse_group(category, dec_group):
        is_decorated = dec_group["decorator"] is not None
        for value in dec_group["values"]:
            module, name = split_qualname(value)
            yield TargetClass(module, name, category, is_decorated)

    for dec_group in audit["models"]["decorators"]:
        yield from parse_group(ClassCategory.MODEL, dec_group)
    for dec_group in audit["endpoints"]["decorators"]:
        yield from parse_group(ClassCategory.ENDPOINT, dec_group)


def _read_audit():
    pipe_input = sys.stdin.read()
    brace_index = pipe_input.index('{"')
    pipe_input = pipe_input[brace_index:]  # strip leading junk
    silo_audit = json.loads(pipe_input)
    return list(_parse_audit(silo_audit))
