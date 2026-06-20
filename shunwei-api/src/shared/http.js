function ok(data = null, msg = 'ok') {
  return {
    status: 200,
    msg,
    data
  };
}

function fail(reply, statusCode, msg, details = null) {
  return reply.code(statusCode).send({
    status: statusCode,
    msg,
    data: details
  });
}

module.exports = { ok, fail };
