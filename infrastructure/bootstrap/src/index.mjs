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
const targets = ['identity', 'next', 'production']
const outputs = {}

for (const target of targets) {
	outputs[target] = {}
	for (const kind of ['state', 'backup']) {
		const name = `${config.prefix}-${target}-${kind}`
		const bucket = new minio.S3Bucket(
			`${target}-${kind}`,
			{ bucket: name, acl: 'private', objectLocking: false, forceDestroy: false },
			protect
		)
		const versioning =
			kind === 'state'
				? new minio.S3BucketVersioning(
						`${target}-state-versioning`,
						{ bucket: bucket.bucket, versioningConfiguration: { status: 'Enabled' } },
						{ ...protect, dependsOn: [bucket] }
					)
				: undefined
		new minio.S3BucketPolicy(
			`${target}-${kind}-policy`,
			{
				bucket: bucket.bucket,
				policy: bucket.bucket.apply((bucketName) =>
					bucketPolicy({
						bucket: bucketName,
						projectId: config.projectId,
						bootstrapAccessKey: config.bootstrapAccessKey,
						deploymentAccessKey: config.credentials[target].deployment,
						observerAccessKey: kind === 'state' ? config.credentials[target].observer : undefined
					})
				)
			},
			{ ...protect, dependsOn: versioning ? [versioning] : [bucket] }
		)
		outputs[target][kind] = bucket.bucket
	}
}

export const buckets = outputs
export const region = config.region
export const endpoint = `https://${config.region}.your-objectstorage.com`
