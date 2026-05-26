import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
    {
        path: '/site',
        name: 'site',
        component: () => import("@/views/site.vue")
    },
    {
        path: '/environment',
        name: 'environment',
        component: () => import("@/views/environment.vue")
    }
];

const router = createRouter({
    history: createWebHashHistory(),
    routes
});

export default router;