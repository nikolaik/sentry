# Generated by Django 2.2.28 on 2023-03-15 20:24

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import sentry.db.models.fields.bounded
import sentry.db.models.fields.foreignkey
from sentry.new_migrations.migrations import CheckedMigration


class Migration(CheckedMigration):
    # This flag is used to mark that a migration shouldn't be automatically run in production. For
    # the most part, this should only be used for operations where it's safe to run the migration
    # after your code has deployed. So this should not be used for most operations that alter the
    # schema of a table.
    # Here are some things that make sense to mark as dangerous:
    # - Large data migrations. Typically we want these to be run manually by ops so that they can
    #   be monitored and not block the deploy for a long period of time while they run.
    # - Adding indexes to large tables. Since this can take a long time, we'd generally prefer to
    #   have ops run this and not block the deploy. Note that while adding an index is a schema
    #   change, it's completely safe to run the operation after the code has deployed.
    is_dangerous = False

    dependencies = [
        ("sentry", "0385_service_hook_hc_fk"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrganizationMemberMapping",
            fields=[
                (
                    "id",
                    sentry.db.models.fields.bounded.BoundedBigAutoField(
                        primary_key=True, serialize=False
                    ),
                ),
                (
                    "organization_id",
                    sentry.db.models.fields.bounded.BoundedBigIntegerField(db_index=True),
                ),
                ("date_created", models.DateTimeField(default=django.utils.timezone.now)),
                ("idempotency_key", models.CharField(max_length=48)),
                ("role", models.CharField(default="member", max_length=32)),
                ("email", models.EmailField(blank=True, max_length=75, null=True)),
                ("invite_status", models.PositiveSmallIntegerField(default=0, null=True)),
                (
                    "inviter",
                    sentry.db.models.fields.foreignkey.FlexibleForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="sentry_inviter_orgmembermapping_set",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "user",
                    sentry.db.models.fields.foreignkey.FlexibleForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="sentry_orgmembermapping_set",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "sentry_organizationmembermapping",
                "unique_together": {("organization_id", "user"), ("organization_id", "email")},
            },
        ),
    ]
