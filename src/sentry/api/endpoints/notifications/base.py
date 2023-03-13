from rest_framework import status
from rest_framework.request import Request

from sentry.api.bases.organization import OrganizationEndpoint
from sentry.api.exceptions import APIException
from sentry.api.permissions import SuperuserPermission
from sentry.models.notificationaction import TriggerGenerator


class BaseNotificationActionsEndpoint(OrganizationEndpoint):
    permission_classes = (SuperuserPermission,)

    def convert_args(self, request: Request, organization_slug: str, action_trigger: str):
        """
        URL path 'action_trigger' should match the choice text for the relevent trigger, and will provide
        the 'action_trigger' kwarg to the endpoint with a tuple of (value, display_text).
        """
        args, kwargs = super().convert_args(request, organization_slug)
        valid_triggers = list(TriggerGenerator())
        valid_action_trigger = next((vt for vt in valid_triggers if vt[1] == action_trigger), None)

        if not valid_action_trigger:
            valid_trigger_text = ", ".join([f"'{vt[1]}'" for vt in valid_triggers])
            raise APIException(
                detail=f"Invalid action_trigger provided. Choose from [{valid_trigger_text}]",
                code=status.HTTP_400_BAD_REQUEST,
            )

        kwargs["action_trigger"] = valid_action_trigger

        return (args, kwargs)
