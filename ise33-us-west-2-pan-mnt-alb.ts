import { DeploymentStack, DeploymentStackProps } from '@amzn/pipelines';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

export class InfraStack extends DeploymentStack {
  constructor(scope: Construct, id: string, props: DeploymentStackProps) {
    super(scope, id, props);

    // Create VPC with public and private subnets across 2 AZs
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private-subnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security group for ALB
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');

    // Security group for EC2 instances
    const instanceSecurityGroup = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    instanceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow traffic from ALB');

    // IAM role for EC2 instances
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    // Launch template for EC2 instances
    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      instanceType: new ec2.InstanceType('t3.xlarge'),
      machineImage: ec2.MachineImage.genericLinux({
        'us-west-2': 'ami-0c337f8aaed1cfeff',
      }),
      role: instanceRole,
      securityGroup: instanceSecurityGroup,
    });

    // ALB setup
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    // Target group for EC2 instances
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [], // Targets will be registered dynamically
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
      },
    });

    // Listener for ALB
    alb.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // Auto Scaling Group
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'AutoScalingGroup', {
      vpc,
      launchTemplate,
      minCapacity: 2,
      maxCapacity: 5,
      desiredCapacity: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Register targets with ALB target group
    targetGroup.addTarget(autoScalingGroup);
  }
}
