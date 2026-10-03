import apkRedirect from '../../workers/operator-apk-redirect/src/index.js';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.androperator.com') {
      url.hostname = 'androperator.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    if (['/operator.apk', '/install.apk', '/apk'].includes(url.pathname)) {
      return apkRedirect.fetch(request, {
        ANDROPERATOR_APK_METADATA_URL: 'https://downloads.androperator.com/operator/latest.json',
      });
    }
    return env.ASSETS.fetch(request);
  },
};
