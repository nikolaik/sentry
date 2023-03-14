import logging

from django.http import Http404, HttpResponse, StreamingHttpResponse
from rest_framework.request import Request
from rest_framework.response import Response
from symbolic import SymbolicError, normalize_debug_id

from sentry import ratelimits
from sentry.api.base import region_silo_endpoint
from sentry.api.bases.project import ProjectEndpoint, ProjectReleasePermission
from sentry.api.endpoints.debug_files import has_download_permission
from sentry.api.serializers import serialize
from sentry.models import DebugIdArtifactBundle, File

logger = logging.getLogger("sentry.api")


@region_silo_endpoint
class ArtifactLookupEndpoint(ProjectEndpoint):
    permission_classes = (ProjectReleasePermission,)

    def download_file(self, file_id, project):
        rate_limited = ratelimits.is_limited(
            project=project,
            key=f"rl:DSymFilesEndpoint:download:{file_id}:{project.id}",
            limit=10,
        )
        if rate_limited:
            logger.info(
                "notification.rate_limited",
                extra={"project_id": project.id, "file_id": file_id},
            )
            return HttpResponse({"Too many download requests"}, status=403)

        file = File.objects.filter(id=file_id).first()

        if file is None:
            raise Http404

        try:
            fp = file.getfile()
            response = StreamingHttpResponse(
                iter(lambda: fp.read(4096), b""), content_type="application/octet-stream"
            )
            response["Content-Length"] = file.size
            return response
        except OSError:
            raise Http404

    def get(self, request: Request, project) -> Response:
        """
        List a Project's Individual Artifacts or Bundles
        ````````````````````````````````````````

        Retrieve a list of individual artifacts or artifact bundles for a given project.

        :pparam string organization_slug: the slug of the organization the
                                          file belongs to.
        :pparam string project_slug: the slug of the project to list the
                                     DIFs of.
        :qparam string debug_ids: If set, will query and return all the artifact
                                  bundles that contain the given `debug_ids`.
        :qparam string urls: If set, will query and return all the individual
                             artifacts, or artifact bundles that contain files
                             that match the `url`. This is using a substring-match.
        :qparam string release: Used in conjunction with `urls`.
        :qparam string dist: Used in conjunction with `urls`.

        :auth: required
        """

        download_requested = request.GET.get("download") is not None
        if download_requested and (has_download_permission(request, project)):
            return self.download_file(request.GET.get("download"), project)
        elif download_requested:
            return Response(status=403)

        # TODO: is there a better way to construct a url to this same route?
        base_url = request.build_absolute_uri(request.path)

        debug_ids = []
        for debug_id in request.GET.getlist("debug_ids"):
            try:
                debug_ids.append(normalize_debug_id(debug_id))
            except SymbolicError:
                pass

        # urls = request.GET.getlist("urls")
        # release = request.GET.get("release")
        # dist = request.GET.get("dist")

        # For debug_ids, we will query for the artifact_bundle/file_id directly
        bundle_file_ids = set(
            DebugIdArtifactBundle.objects.filter(
                organization_id=project.organization.id,
                debug_id__in=debug_ids,
            )
            .select_related("artifact_bundle")
            .values_list("artifact_bundle__file_id", flat=True)
            .distinct("artifact_bundle__file_id")
        )

        # If we have `urls`, we want to:
        # First, get the newest X artifact bundles, and *look inside them* to
        # figure out if the file is included in them
        # XXX: does that even work for partial matches?
        # As in: `urls` would have `"/path/to/file"` for a file with the full url
        # `"~/path/to/file.min.js"`.

        # TODO: also query for and return bundles based on `urls`

        # Possibly use the algorithm sketched up here:
        # https://github.com/getsentry/sentry/pull/45697#issuecomment-1466389132
        # That would narrow down our set of bundles to the minimum set that covers
        # the file names we are querying for, and also leave us with the remaining
        # set of file names that are not covered by any bundle, to look up below
        # TODO: add those to `bundle_file_ids`

        # Second, look for a legacy `ReleaseFile` (or whatever) if an individual
        # file exists matching the release/dist/url we are looking for.

        # TODO: also query for and return individual artifacts
        individual_files = set()

        # Then: Construct our response

        found_artifacts = []
        for file_id in bundle_file_ids:
            # TODO: is there a better way to construct a url to this same route?
            url = f"{base_url}?download={file_id}"
            found_artifacts.append(
                {
                    "type": "bundle",
                    "url": url,
                }
            )

        for file in individual_files:
            # TODO: is there a better way to construct a url to this same route?
            url = f"{base_url}?download={file.id}"
            found_artifacts.append(
                {
                    "type": "bundle",
                    "url": url,
                    # I believe `name` is the url/abs_path of the file?
                    # As in: `"~/path/to/file.min.js"`?
                    "abs_path": file.name,
                    # These headers should ideally include the `Sourcemap` reference
                    "headers": file.headers,
                }
            )

        # TODO: how to properly paginate this thing?
        return Response(serialize(found_artifacts, request.user))
