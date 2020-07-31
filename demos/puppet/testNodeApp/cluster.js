const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  // Take advantage of multiple CPUs
  const cpus = os.cpus().length;

  console.log(`Taking advantage of ${cpus} CPUs`)
  for (let i = 0; i < cpus/2; i++) {
    cluster.fork();
  }
  // set console's directory so we can see output from workers
  console.dir(cluster.workers, {depth: 0});

  // initialize our CLI
  process.stdin.on('data', (data) => {
    initControlCommands(data);
  })

  cluster.on('exit', (worker, code) => {
    // Good exit code is 0 :))
    if (code !== 0 && !worker.exitedAfterDisconnect) {
      console.log(`\x1b[34mWorker ${worker.process.pid} crashed.\nStarting a new worker...\n\x1b[0m`);
      const nw = cluster.fork();
      console.log(`\x1b[32mWorker ${nw.process.pid} will replace him \x1b[0m`);
    }
  });

  console.log(`Master PID: ${process.pid}`)
} else {
  require('../puppet.js');
}
