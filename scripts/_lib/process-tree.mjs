export async function stopProcessTree(child, options = {}) {
  if (!child) return;

  const forceAfterMs = Number.isFinite(options.forceAfterMs) ? options.forceAfterMs : 1500;
  const doneAfterMs = Number.isFinite(options.doneAfterMs) ? options.doneAfterMs : 3000;

  const signal = (name) => {
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, name);
      } else {
        child.kill(name);
      }
    } catch {
      // The process may already be gone.
    }
  };

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(forceTimer);
      clearTimeout(doneTimer);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref?.();
      resolve();
    };
    const forceTimer = setTimeout(() => signal("SIGKILL"), forceAfterMs);
    const doneTimer = setTimeout(finish, doneAfterMs);
    child.once("exit", finish);
    child.once("close", finish);
    signal("SIGTERM");
  });
}
