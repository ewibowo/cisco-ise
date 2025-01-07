import { DeploymentStack, DeploymentStackProps } from '@amzn/pipelines';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';

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

    // Security group for NLB
    const nlbSecurityGroup = new ec2.SecurityGroup(this, 'NlbSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });
    nlbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');

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

    // Two ISE instances
    const instance1 = new ec2.Instance(this, 'ISEInstance1', {
      vpc,
      instanceType: new ec2.InstanceType('t3.xlarge'),
      machineImage: ec2.MachineImage.genericLinux({
        'us-east-1': 'ami-02cf2eba3e7ef8f6f',
      }),
      role: instanceRole,
      securityGroup: instanceSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const instance2 = new ec2.Instance(this, 'ISEInstance2', {
      vpc,
      instanceType: new ec2.InstanceType('t3.xlarge'),
      machineImage: ec2.MachineImage.genericLinux({
        'us-east-1': 'ami-02cf2eba3e7ef8f6f',
      }),
      role: instanceRole,
      securityGroup: instanceSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // NLB setup
    const nlb = new elbv2.NetworkLoadBalancer(this, 'NLB', {
      vpc,
      internetFacing: true,
    });

    // Target group for EC2 instances
    const targetGroup = new elbv2.NetworkTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.Protocol.TCP,
      targets: [
        // Add EC2 instances as targets
        elbv2.NetworkTarget.fromInstanceId(instance1.instanceId),
        elbv2.NetworkTarget.fromInstanceId(instance2.instanceId),
      ],
      healthCheck: {
        port: '80',
        interval: cdk.Duration.seconds(30),
      },
    });

    // Listener for NLB
    nlb.addListener('Listener', {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });
  }
}
