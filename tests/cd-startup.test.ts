import assert from "node:assert/strict";
import test from "node:test";
import {
	StartupCwdCoordinator,
	consumeStartupCwdRequests,
	requestStartupCwd,
	resetStartupCwdRequestsForTests,
	startupCwdRequestsWereConsumed,
} from "../extensions/lib/cd-startup.ts";

test("single startup cwd request is consumed as migration", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.request("evanescent", "/tmp/work");
	assert.deepEqual(coordinator.consume(), {
		kind: "migrate",
		targetCwd: "/tmp/work",
		requests: [
			{
				requester: "evanescent",
				targetCwd: "/tmp/work",
				requiresFreshSession: undefined,
			},
		],
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
			{ requester: "a", targetCwd: "/tmp/a", requiresFreshSession: undefined },
			{ requester: "b", targetCwd: "/tmp/b", requiresFreshSession: undefined },
		],
	});
});

test("module-level startup cwd API shares requests across extensions", () => {
	resetStartupCwdRequestsForTests();
	assert.equal(startupCwdRequestsWereConsumed(), false);
	requestStartupCwd("evanescent", "/tmp/work", {
		requiresFreshSession: true,
	});
	assert.deepEqual(consumeStartupCwdRequests(), {
		kind: "migrate",
		targetCwd: "/tmp/work",
		requests: [
			{
				requester: "evanescent",
				targetCwd: "/tmp/work",
				requiresFreshSession: true,
			},
		],
	});
	assert.equal(startupCwdRequestsWereConsumed(), true);
	assert.throws(() => requestStartupCwd("late", "/tmp/other"), /closed/);
	resetStartupCwdRequestsForTests();
});

test("startup cwd requests are rejected after consumption", () => {
	const coordinator = new StartupCwdCoordinator();
	coordinator.consume();
	assert.throws(() => coordinator.request("late", "/tmp/work"), /closed/);
	assert.throws(() => coordinator.consume(), /already been consumed/);
});
