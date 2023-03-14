from __future__ import annotations

from typing import List

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ParseError
from rest_framework.request import Request
from rest_framework.response import Response

from sentry.api.base import region_silo_endpoint
from sentry.api.paginator import OffsetPaginator
from sentry.api.serializers import serialize
from sentry.api.utils import get_date_range_from_params
from sentry.apidocs.constants import RESPONSE_FORBIDDEN, RESPONSE_NOTFOUND, RESPONSE_UNAUTHORIZED
from sentry.apidocs.parameters import GLOBAL_PARAMS, MONITOR_PARAMS
from sentry.apidocs.utils import inline_sentry_response_serializer
from sentry.models import Environment, ProjectKey
from sentry.monitors.models import MonitorCheckIn, MonitorEnvironment
from sentry.monitors.serializers import MonitorCheckInSerializerResponse

from .base import MonitorEndpoint


@region_silo_endpoint
@extend_schema(tags=["Crons"])
class OrganizationMonitorCheckInIndexEndpoint(MonitorEndpoint):
    public = {"GET"}

    @extend_schema(
        operation_id="Retrieve check-ins for a monitor",
        parameters=[
            GLOBAL_PARAMS.ORG_SLUG,
            MONITOR_PARAMS.MONITOR_ID,
            MONITOR_PARAMS.CHECKIN_ID,
        ],
        responses={
            200: inline_sentry_response_serializer(
                "CheckInList", List[MonitorCheckInSerializerResponse]
            ),
            401: RESPONSE_UNAUTHORIZED,
            403: RESPONSE_FORBIDDEN,
            404: RESPONSE_NOTFOUND,
        },
    )
    def get(
        self, request: Request, project, monitor, organization_slug: str | None = None
    ) -> Response:
        """
        Retrieve a list of check-ins for a monitor
        """
        # we don't allow read permission with DSNs
        if isinstance(request.auth, ProjectKey):
            return self.respond(status=401)

        start, end = get_date_range_from_params(request.GET)
        if start is None or end is None:
            raise ParseError(detail="Invalid date range")

        environment_param = request.GET.get("environment")
        if not environment_param:
            queryset = MonitorCheckIn.objects.filter(
                monitor_id=monitor.id, date_added__gte=start, date_added__lte=end
            )
        else:
            try:
                environment = Environment.object.get(name=environment_param)
                monitor_env = MonitorEnvironment.objects.get(
                    monitor=monitor, environment=environment
                )
            except Environment.DoesNotExist:
                raise ParseError(detail="Environment does not exist")
            except MonitorEnvironment.DoesNotExist:
                raise ParseError(detail="Monitor has not received checkins for that Environment")

            queryset = MonitorCheckIn.objects.filter(
                monitor_environment_id=monitor_env.id, date_added__gte=start, date_added__lte=end
            )

        return self.paginate(
            request=request,
            queryset=queryset,
            order_by="-date_added",
            on_results=lambda x: serialize(x, request.user),
            paginator_cls=OffsetPaginator,
        )
