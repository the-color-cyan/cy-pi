import assert from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";

const execFile = promisify(execFileCallback);
const sourceRoot = new URL("..", import.meta.url).pathname;

async function executable(path: string, content: string) {
	await writeFile(path, content, "utf8");
	await chmod(path, 0o755);
}

test("the extension package lock is committed as initializer input", async () => {
	const lock = await readFile(
		join(sourceRoot, "npm", "package-lock.json"),
		"utf8",
	);
	const ignoreRules = await readFile(
		join(sourceRoot, "npm", ".gitignore"),
		"utf8",
	);

	assert.match(lock, /"lockfileVersion": 3/);
	assert.match(ignoreRules, /^!package-lock\.json$/m);
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "cy-pi-init-test-"));
	const repo = join(root, "cy-pi");
	const home = join(root, "home");
	const systemBin = join(root, "system-bin");
	await mkdir(join(repo, "scripts"), { recursive: true });
	await mkdir(join(repo, "node_modules", ".bin"), { recursive: true });
	await mkdir(join(repo, "npm"), { recursive: true });
	await mkdir(home, { recursive: true });
	await mkdir(systemBin, { recursive: true });

	await writeFile(join(repo, "package.json"), "{}\n");
	await writeFile(join(repo, "package-lock.json"), "{}\n");
	await writeFile(join(repo, "npm", "package.json"), "{}\n");
	await writeFile(join(repo, "npm", "package-lock.json"), "{}\n");
	await writeFile(join(repo, "settings.example.json"), "{}\n");
	for (const script of ["init-agent-home.sh", "pi-home.sh"]) {
		await writeFile(
			join(repo, "scripts", script),
			await readFile(join(sourceRoot, "scripts", script), "utf8"),
		);
		await chmod(join(repo, "scripts", script), 0o755);
	}

	await executable(
		join(repo, "node_modules", ".bin", "pi"),
		'#!/usr/bin/env bash\nprintf "runtime=canonical\\nagent_home=%s\\nargs=%s\\n" "$PI_CODING_AGENT_DIR" "$*"\n',
	);
	await executable(
		join(systemBin, "pi"),
		"#!/usr/bin/env bash\nprintf 'runtime=old-global\\n'\n",
	);
	await executable(join(systemBin, "npm"), "#!/usr/bin/env bash\nexit 0\n");
	await executable(
		join(repo, "scripts", "update-agent-home.sh"),
		"#!/usr/bin/env bash\nprintf 'agent-home-update\\n'\n",
	);
	await executable(
		join(repo, "scripts", "update-pi-runtime.sh"),
		"#!/usr/bin/env bash\nprintf 'runtime-update\\n'\n",
	);

	const env = {
		...process.env,
		HOME: home,
		PATH: `${join(repo, "node_modules", ".bin")}:${systemBin}:/usr/bin:/bin`,
	};
	await execFile("bash", [join(repo, "scripts", "init-agent-home.sh")], {
		env,
	});
	return { repo, home, systemBin, env };
}

test("init repairs PATH and wrapper runs the canonical checkout runtime", async () => {
	const { repo, home, systemBin } = await createFixture();
	const shell = [
		'source "$HOME/.bashrc"',
		'printf "resolved=%s\\n" "$(command -v pi)"',
		"pi status",
	].join("; ");
	const { stdout } = await execFile("bash", ["-c", shell], {
		env: {
			...process.env,
			HOME: home,
			PATH: `${join(repo, "node_modules", ".bin")}:${systemBin}:/usr/bin:/bin`,
		},
	});

	assert.ok(stdout.includes(`resolved=${join(repo, "bin", "pi")}`));
	assert.match(stdout, /runtime=canonical/);
	assert.ok(stdout.includes(`agent_home=${repo}`));
	assert.match(stdout, /args=status/);
	assert.doesNotMatch(stdout, /old-global/);

	const bashrc = await readFile(join(home, ".bashrc"), "utf8");
	assert.equal((bashrc.match(/cy-pi agent-home PATH/g) ?? []).length, 2);
	assert.match(bashrc, /cy_pi_old_node_bin=/);
});

test("pi-home fails closed when the canonical wrapper is missing", async () => {
	const { repo, env } = await createFixture();
	await rm(join(repo, "bin", "pi"));

	const { stdout } = await execFile(
		"bash",
		[
			"-c",
			'"$1" 2>&1; status=$?; printf "status=%s\\n" "$status"; test "$status" -ne 0',
			"_",
			join(repo, "scripts", "pi-home.sh"),
		],
		{ env },
	);

	assert.match(stdout, /Canonical Pi wrapper is missing/);
	assert.match(stdout, /status=1/);
	assert.doesNotMatch(stdout, /runtime=old-global/);
});

test("wrapper routes self and extension update forms without recursion", async () => {
	const { repo, env } = await createFixture();
	const wrapper = join(repo, "bin", "pi");

	const bare = await execFile(wrapper, ["update"], { env });
	assert.equal(bare.stdout, "agent-home-update\nruntime-update\n");

	const all = await execFile(wrapper, ["update", "--all"], { env });
	assert.match(all.stdout, /agent-home-update\nruntime-update\n/);
	assert.match(all.stdout, /runtime=canonical/);
	assert.match(all.stdout, /args=update --extensions/);

	const source = await execFile(wrapper, ["update", "npm:example"], { env });
	assert.match(source.stdout, /agent-home-update\n/);
	assert.doesNotMatch(source.stdout, /runtime-update/);
	assert.match(source.stdout, /args=update npm:example/);
});
