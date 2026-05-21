import assert from "node:assert/strict";
import test from "node:test";
import { StartupCwdCoordinator } from "../extensions/lib/cd-startup.ts";

test("single startup cwd request is consumed as migration", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.request("evanescent", "/tmp/work");
	assert.deepEqual(coordinator.consume(), {
		kind: "migrate",
		targetCwd: "/tmp/work",
		requests: [{ requester: "evanescent", targetCwd: "/tmp/work" }],
	});
});

test("identical startup cwd requests coalesce", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.request("a", "/tmp/work");
	coordinator.request("b", "/tmp/work");
	const resolution = coordinator.consume();
	assert.equal(resolution.kind, "migrate");
	assert.equal(resolution.kind === "migrate" && resolution.requests.length, 2);
});

test("conflicting headless startup cwd requests fail closed as conflict", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.request("a", "/tmp/a");
	coordinator.request("b", "/tmp/b");
	assert.deepEqual(coordinator.consume(), {
		kind: "conflict",
		targets: ["/tmp/a", "/tmp/b"],
		requests: [
			{ requester: "a", targetCwd: "/tmp/a" },
			{ requester: "b", targetCwd: "/tmp/b" },
		],
	});
});

test("startup cwd requests are rejected after consumption", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.consume();
	assert.throws(() => coordinator.request("late", "/tmp/work"), /closed/);
	assert.throws(() => coordinator.consume(), /already been consumed/);
});
