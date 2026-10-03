import apkRedirect from '../../workers/operator-apk-redirect/src/index.js';

export default {
  fetch(request, env) {
    if (['/operator.apk', '/install.apk', '/apk'].includes(new URL(request.url).pathname)) {
      return apkRedirect.fetch(request, {
        ANDROPERATOR_APK_METADATA_URL: 'https://downloads.androperator.com/operator/latest.json',
      });
    }
    return env.ASSETS.fetch(request);
  },
};
