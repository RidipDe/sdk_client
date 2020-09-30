// const AWS = require('aws-sdk');
// AWS.config.update({region: 'us-east-1'});
// var cloudWatch = new AWS.CloudWatch({
//   apiVersion: '2010-08-01',
//   credentials: {
//     accessKeyId: "",
//     secretAccessKey: ""
//   }
//
// });

export default class CloudWatchLogger {
  async emitMetric(namespace: string, metric_name: string, dimensions: any): Promise<void> {
    namespace = namespace.trim();
    metric_name = metric_name.trim();
    console.log(`Emitting metric: ${namespace}/${metric_name} : 1`);
    var params = {
      MetricData: [
        {
          MetricName: metric_name,
          Dimensions: dimensions,
          Unit: 'None',
          Value: 1
        },
      ],
      Namespace: namespace
    };
    await this.publishMetricToCloudWatch(params);
  }

  private async publishMetricToCloudWatch(params: any) {
    try {
      //await cloudWatch.putmetricdata(params).promise();
    } catch (error) {
      console.log(`Unable to emit metric: ${error}`)
    }
  }
}

