from io import BytesIO
from uuid import uuid4

from django.urls import reverse

from sentry.models import ArtifactBundle, DebugIdArtifactBundle, File, SourceFileType
from sentry.testutils import APITestCase


class ArtifactLookupTest(APITestCase):
    @staticmethod
    def make_file(artifact_name, content):
        file = File.objects.create(name=artifact_name, type="artifact.bundle")
        file.putfile(BytesIO(content))

        return file

    def test_query_by_debug_ids(self):
        debug_id_a = "aaaaaaaa-0000-0000-0000-000000000000"
        debug_id_b = "bbbbbbbb-0000-0000-0000-000000000000"
        file_ab = self.make_file("bundle_ab.zip", b"ab")

        bundle_id_ab = uuid4()
        artifact_bundle_ab = ArtifactBundle.objects.create(
            organization_id=self.organization.id,
            bundle_id=bundle_id_ab,
            file=file_ab,
            artifact_count=2,
        )

        DebugIdArtifactBundle.objects.create(
            organization_id=self.organization.id,
            debug_id=debug_id_a,
            artifact_bundle=artifact_bundle_ab,
            source_file_type=SourceFileType.SOURCE_MAP.value,
        )
        DebugIdArtifactBundle.objects.create(
            organization_id=self.organization.id,
            debug_id=debug_id_b,
            artifact_bundle=artifact_bundle_ab,
            source_file_type=SourceFileType.SOURCE_MAP.value,
        )

        debug_id_c = "cccccccc-0000-0000-0000-000000000000"
        file_c = self.make_file("bundle_c.zip", b"c")

        bundle_id_c = uuid4()
        artifact_bundle_c = ArtifactBundle.objects.create(
            organization_id=self.organization.id,
            bundle_id=bundle_id_c,
            file=file_c,
            artifact_count=1,
        )

        DebugIdArtifactBundle.objects.create(
            organization_id=self.organization.id,
            debug_id=debug_id_c,
            artifact_bundle=artifact_bundle_c,
            source_file_type=SourceFileType.SOURCE_MAP.value,
        )

        self.login_as(user=self.user)

        url = reverse(
            "sentry-api-0-project-artifact-lookup",
            kwargs={
                "organization_slug": self.project.organization.slug,
                "project_slug": self.project.slug,
            },
        )

        # query by one debug-id
        response = self.client.get(f"{url}?debug_ids={debug_id_a}").json()

        assert len(response) == 1
        assert response[0]["type"] == "bundle"

        response = self.client.get(response[0]["url"])
        for chunk in response.streaming_content:
            assert chunk == b"ab"

        # query by two debug-ids pointing to the same bundle
        response = self.client.get(f"{url}?debug_ids={debug_id_a}&debug_ids={debug_id_b}").json()

        assert len(response) == 1
        assert response[0]["type"] == "bundle"

        response = self.client.get(response[0]["url"])
        for chunk in response.streaming_content:
            assert chunk == b"ab"

        # query by two debug-ids pointing to different bundles
        response = self.client.get(f"{url}?debug_ids={debug_id_a}&debug_ids={debug_id_c}").json()

        assert len(response) == 2
        assert response[0]["type"] == "bundle"
        assert response[1]["type"] == "bundle"

        url_ab = response[0]["url"]
        url_c = response[1]["url"]

        response = self.client.get(url_ab)
        for chunk in response.streaming_content:
            assert chunk == b"ab"

        response = self.client.get(url_c)
        for chunk in response.streaming_content:
            assert chunk == b"c"
