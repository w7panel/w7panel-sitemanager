import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
    {
        path: '/',
        name: 'home',
        component: () => import("@/views/home.vue")
    },
    {
        path: '/:containerName/:imageName/:version',
        name: 'environment',
        component: () => import("@/views/environment.vue")
    }
];

const router = createRouter({
    history: createWebHashHistory(),
    routes
});

export default router;
