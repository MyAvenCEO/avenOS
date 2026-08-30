import * as minio from '@pulumi/minio'
import * as pulumi from '@pulumi/pulumi'
import { loadBootstrapConfig } from './config.mjs'
import { bucketPolicy } from './policy.mjs'

const config = loadBootstrapConfig()
const provider = new minio.Provider('hetzner-object-storage', {
	minioUser: pulumi.secret(config.bootstrapAccessKey),
	minioPassword: pulumi.secret(config.bootstrapSecretKey),
	minioServer: `${config.region}.your-objectstorage.com`,
	minioRegion: config.region,
	minioSsl: true,
	minioInsecure: false
})

const protect = { provider, protect: true }
const outputs = {}

for (const kind of ['state', 'backup']) {
	const name = `${config.prefix}-${config.projectId}-${config.target}-${kind}`
	const bucket = new minio.S3Bucket(
		`${config.target}-${kind}`,
		{ bucket: name, acl: 'private', objectLocking: false, forceDestroy: false },
		protect
	)
	const versioning =
		kind === 'state'
			? new minio.S3BucketVersioning(
					`${config.target}-state-versioning`,
					{ bucket: bucket.bucket, versioningConfiguration: { status: 'Enabled' } },
					{ ...protect, dependsOn: [bucket] }
				)
			: undefined
	new minio.S3BucketPolicy(
		`${config.target}-${kind}-policy`,
		{
			bucket: bucket.bucket,
			policy: bucket.bucket.apply((bucketName) =>
				bucketPolicy({
					bucket: bucketName,
					projectId: config.projectId,
					bootstrapAccessKey: config.bootstrapAccessKey,
					deploymentAccessKey: config.deploymentAccessKey,
					observerAccessKey: kind === 'state' ? config.observerAccessKey : undefined
				})
			)
		},
		{ ...protect, dependsOn: versioning ? [versioning] : [bucket] }
	)
	outputs[kind] = bucket.bucket
}

export const buckets = outputs
export const target = config.target
export const region = config.region
export const endpoint = `https://${config.region}.your-objectstorage.com`
