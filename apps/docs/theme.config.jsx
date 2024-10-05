/**
 * @type {import('nextra-theme-docs').DocsThemeConfig}
 */
export default {
  logo: <span style={{ fontWeight: 600 }}>ReactStore</span>,
  project: {
    link: 'https://github.com/jozefini/react-store'
  },
  docsRepositoryBase: 'https://github.com/jozefini/react-store/apps/docs',
  useNextSeoProps() {
    return {
      titleTemplate: '%s – React Store'
    };
  },
  nextThemes: {
    defaultTheme: 'light'
  },
  editLink: {
    component: () => null
  },
  feedback: {
    content: () => null
  },
  footer: { component: () => null },
  primaryHue: 30,
  primarySaturation: 100
};
