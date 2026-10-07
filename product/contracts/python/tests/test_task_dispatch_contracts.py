import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class TaskDispatchContractsTest(unittest.TestCase):
    identifier = "a0000000-0000-4000-8000-000000000001"
    other = "a0000000-0000-4000-8000-000000000002"

    def scope(self):
        return {"taskId": self.identifier, "taskRevision": 1, "projectId": self.identifier,
                "taskAttemptId": self.identifier, "deviceId": self.identifier, "identityId": self.identifier}

    def task(self):
        return {"protocolVersion": "2026-10-01.task-v1", **self.scope(), "kind": "publish_content", "platform": "facebook", "form": "facebook_video",
                "arrangementRevision": 1, "projectVersion": 1, "assignmentId": self.identifier, "assignmentVersion": 1, "approvalId": self.identifier, "approvalVersion": 1,
                "contentUnitId": self.identifier, "variantId": self.identifier, "materialRevision": 1, "languageTag": "en-us",
                "objects": [{"objectId": self.identifier, "sha256": "a" * 64, "bytes": 12, "contentType": "video/mp4"}], "title": "Explicit title", "caption": "Explicit caption\nsecond line",
                "scheduledAt": "2026-10-01T00:00:00.123456789123Z", "window": {"startsAt": "2026-10-01T00:00:00.123456789123Z", "endsAt": "2026-10-01T00:00:01Z"},
                "recovery": {"roundId": self.identifier, "maxAttempts": 2, "maxElapsedMs": 300000}}

    def invalid(self, name, original, patches):
        contracts = FirstBatchContracts()
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ContractValidationError):
                contracts.validate(name, {**original, **patch})

    def test_strict_central_scope_and_no_privileges(self):
        task = self.task()
        FirstBatchContracts().validate("centralPublicationTask", task)
        self.invalid("centralPublicationTask", task, ({"taskId": None}, {"taskAttemptId": None}, {"protocolVersion": "old"}, {"taskRevision": 0}, {"assignmentVersion": True},
                     {"materialRevision": 1001}, {"shell": "arbitrary command"}, {"executionAllowed": True}, {"accessToken": "secret"},
                     {"objects": [{**task["objects"][0], "key": "private"}]}, {"languageTag": "en-US"}, {"title": " explicit"}, {"title": "\ufeffexplicit"},
                     {"caption": "contains\x00nul"}, {"recovery": {**task["recovery"], "maxElapsedMs": 0}}))

    def test_forms_ordered_objects_and_platform(self):
        task = self.task()
        obj = task["objects"][0]
        for form in ("facebook_video", "facebook_image_text", "youtube_shorts", "youtube_video"):
            objects = [{**obj, "contentType": "image/png"}, {**obj, "objectId": self.other, "contentType": "image/jpeg"}] if form == "facebook_image_text" else task["objects"]
            FirstBatchContracts().validate("centralPublicationTask", {**task, "form": form, "platform": "facebook" if form.startswith("facebook_") else "youtube", "objects": objects})
        self.invalid("centralPublicationTask", task, ({"platform": "youtube"}, {"objects": []}, {"objects": [obj, {**obj, "objectId": self.other}]},
                     {"objects": [{**obj, "contentType": "image/png"}]}, {"form": "facebook_image_text", "objects": [obj]},
                     {"form": "facebook_image_text", "objects": [{**obj, "contentType": "image/png"}, {**obj, "objectId": self.identifier.upper(), "contentType": "image/png"}]}))

    def test_exact_window_and_fraction(self):
        task = self.task()
        FirstBatchContracts().validate("centralPublicationTask", {**task, "scheduledAt": "2026-10-01T08:00:00.123456789123+08:00"})
        self.invalid("centralPublicationTask", task, ({"scheduledAt": "2026-10-01T00:00:00.123456789122Z"}, {"scheduledAt": task["window"]["endsAt"]},
                     {"window": {"startsAt": task["window"]["endsAt"], "endsAt": task["window"]["startsAt"]}}, {"scheduledAt": "0000-01-01T00:00:00Z"}))

    def test_notice_is_recheck_only(self):
        notice = {"protocolVersion": "2026-10-01.task-v1", "messageId": self.identifier, **self.scope(), "purpose": "recheck_central_task", "executionAllowed": False}
        FirstBatchContracts().validate("taskDispatchNotice", notice)
        self.invalid("taskDispatchNotice", notice, ({"purpose": "publish"}, {"executionAllowed": True}, {"objects": self.task()["objects"]},
                     {"caption": "private caption"}, {"permit": self.identifier}, {"status": "completed"}))

    def test_observed_completion_is_not_verified_publication(self):
        row = {"protocolVersion": "2026-10-01.task-v1", **self.scope(), "sourceId": self.identifier, "sourceEventId": self.identifier,
               "occurredAt": "2026-10-01T00:00:00.123456789123Z", "receivedAt": "2026-10-01T00:00:00.123456789123Z",
               "engineState": "completed", "publicationState": "not_submitted", "platformContentId": None, "evidenceIds": []}
        contracts = FirstBatchContracts()
        contracts.validate("taskExecutionObservation", row)
        contracts.validate("taskExecutionObservation", {**row, "engineState": "failed", "publicationState": "submission_unknown"})
        contracts.validate("taskExecutionObservation", {**row, "publicationState": "reported_published", "platformContentId": "explicit-platform-id", "evidenceIds": [self.identifier]})
        contracts.validate("taskExecutionObservation", {**row, "publicationState": "reported_not_published", "evidenceIds": [self.identifier]})
        self.invalid("taskExecutionObservation", row, ({"occurredAt": "2026-10-01T00:00:00.123456789124Z"}, {"publicationState": "published_verified"},
                     {"publicationState": "reported_published"}, {"publicationState": "reported_not_published"}, {"platformContentId": "unrelated"},
                     {"evidenceIds": [self.identifier, self.identifier.upper()]}, {"secret": "private"}, {"occurredAt": "0000-01-01T00:00:00Z"}))
