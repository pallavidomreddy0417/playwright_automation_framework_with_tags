/**
 * JS equivalent of your Java try/catch per step:
 * - log PASS/FAIL to Extent report
 * - store last exception on ctx (like Hooks.setLastException)
 * - rethrow so the test fails
 */

function attachStepHelpers({ reporter, testEntry, ctx }) {
  ctx.lastException = null;

  ctx.setLastException = (err) => {
    ctx.lastException = err;
  };

  ctx.step = async (stepName, fn) => {
    try {
      const result = await fn();
      reporter.logStepPass(testEntry, stepName);
      return result;
    } catch (err) {
      // Keep the original step name so reports can show the exact failing step.
      reporter.logStepFail(testEntry, stepName, err);
      ctx.setLastException(err);
      throw err;
    }
  };

  return ctx;
}

module.exports = { attachStepHelpers };


